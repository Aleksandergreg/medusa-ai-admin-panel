import { extractToolJsonPayload, isPlainRecord } from "../../lib/utils";
import { HistoryEntry } from "../../lib/types";
import { ValidationRequest } from "./types";
import { buildLabelMap, pickLabelFromRecord } from "../../lib/label-utils";
import {
  extractRecord,
  formatData,
  hasRenderableData,
  normalizeBodyForDisplay,
} from "../../lib/formatters";

type PlainRecord = Record<string, unknown>;

const DIFF_VALUE_MAX_LENGTH = 120;
const DIFF_KEYS = [
  "body",
  "pathParams",
  "path_parameters",
  "query",
  "queryParams",
  "headers",
];
const MAX_DIFF_NOTES = 6;
const MAX_DIFF_DEPTH = 4;

const formatOperationTitle = (operationId: string): string => {
  if (!operationId) {
    return "";
  }
  const withoutPrefix = operationId.replace(
    /^(Admin|Store)(Post|Delete|Put|Patch)/i,
    ""
  );
  const spaced = withoutPrefix.replace(/([A-Z])/g, " $1").trim();

  const isDelete = /Delete/i.test(operationId);
  const isUpdate = /(Put|Patch)/i.test(operationId);
  const isCreate = /Post/i.test(operationId);

  let action = "Modify";
  if (isDelete) action = "Delete";
  else if (isCreate) action = "Create";
  else if (isUpdate) action = "Update";

  return `${action} ${spaced}`;
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3)}...`;
};

const formatDiffValue = (value: unknown): string => {
  if (value === undefined) {
    return "`undefined`";
  }
  if (typeof value === "string") {
    const normalized = truncateText(value, DIFF_VALUE_MAX_LENGTH);
    return `"${normalized}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }

  try {
    const json = JSON.stringify(value);
    if (!json) {
      return String(value);
    }
    return truncateText(json, DIFF_VALUE_MAX_LENGTH);
  } catch {
    return truncateText(String(value), DIFF_VALUE_MAX_LENGTH);
  }
};

const stableStringify = (value: unknown): string => {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as PlainRecord;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
};

const valuesEqual = (a: unknown, b: unknown): boolean => {
  return stableStringify(a) === stableStringify(b);
};

const describeChange = (
  path: string,
  previous: unknown,
  current: unknown
): string => {
  if (previous === undefined) {
    return `Added \`${path}\` = ${formatDiffValue(current)}`;
  }
  if (current === undefined) {
    return `Removed \`${path}\` (was ${formatDiffValue(previous)})`;
  }
  return `Updated \`${path}\` from ${formatDiffValue(
    previous
  )} to ${formatDiffValue(current)}`;
};

const recordDiff = (
  path: string,
  previous: unknown,
  current: unknown,
  notes: string[],
  depth: number
): void => {
  if (notes.length >= MAX_DIFF_NOTES) {
    return;
  }

  if (valuesEqual(previous, current)) {
    return;
  }

  if (
    depth < MAX_DIFF_DEPTH &&
    isPlainRecord(previous) &&
    isPlainRecord(current)
  ) {
    const prevRecord = previous as PlainRecord;
    const currRecord = current as PlainRecord;
    const keys = new Set([
      ...Object.keys(prevRecord),
      ...Object.keys(currRecord),
    ]);
    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      recordDiff(nextPath, prevRecord[key], currRecord[key], notes, depth + 1);
      if (notes.length >= MAX_DIFF_NOTES) {
        return;
      }
    }
    return;
  }

  if (
    Array.isArray(previous) &&
    Array.isArray(current) &&
    valuesEqual(previous, current)
  ) {
    return;
  }

  notes.push(describeChange(path, previous, current));
};

const collectDiffNotes = (
  previousArgs: PlainRecord | undefined,
  currentArgs: PlainRecord
): string[] => {
  if (!previousArgs) {
    return [];
  }

  const notes: string[] = [];
  for (const key of DIFF_KEYS) {
    const prevValue = previousArgs[key];
    const currValue = currentArgs[key];
    if (prevValue === undefined && currValue === undefined) {
      continue;
    }
    const pathLabel = key === "path_parameters" ? "pathParams" : key;
    recordDiff(pathLabel, prevValue, currValue, notes, 0);
    if (notes.length >= MAX_DIFF_NOTES) {
      break;
    }
  }

  return notes;
};

const isErrorResult = (result: unknown): result is PlainRecord => {
  if (!isPlainRecord(result)) {
    return false;
  }

  if (result.error === true || result.isError === true) {
    return true;
  }

  const statusCandidates = [
    result.status,
    result.statusCode,
    result.status_code,
    result.code,
  ];

  for (const candidate of statusCandidates) {
    if (typeof candidate === "number" && candidate >= 400) {
      return true;
    }
  }

  const nestedResult = result.result;
  if (isPlainRecord(nestedResult)) {
    if (nestedResult.isError === true) {
      return true;
    }
    const nestedStatus = (nestedResult as PlainRecord).status;
    if (typeof nestedStatus === "number" && nestedStatus >= 400) {
      return true;
    }
  }

  return false;
};

const extractErrorMessage = (result: unknown): string | undefined => {
  if (!isPlainRecord(result)) {
    return undefined;
  }

  const candidates: unknown[] = [
    result.message,
    result.error && typeof result.error === "string" ? result.error : undefined,
  ];

  const data = result.data;
  if (isPlainRecord(data)) {
    candidates.push(data.message);
    const errors = data.errors;
    if (Array.isArray(errors)) {
      for (const entry of errors) {
        if (typeof entry === "string") {
          candidates.push(entry);
        } else if (isPlainRecord(entry) && typeof entry.message === "string") {
          candidates.push(entry.message);
        }
      }
    }
  }

  const nestedResult = result.result;
  if (isPlainRecord(nestedResult)) {
    candidates.push(nestedResult.message);
    const content = nestedResult.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (isPlainRecord(item) && typeof item.text === "string") {
          candidates.push(item.text);
        }
      }
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length) {
        return truncateText(trimmed, 160);
      }
    }
  }

  return undefined;
};

export function buildValidationSummary(
  request: ValidationRequest,
  history: HistoryEntry[]
): string {
  const method = (request.method ?? "POST").toUpperCase();
  const action =
    method === "DELETE"
      ? "delete"
      : method === "POST"
      ? "create"
      : method === "PUT" || method === "PATCH"
      ? "update"
      : "process";

  const bodyData = normalizeBodyForDisplay(
    (request.args as Record<string, unknown>)["body"]
  );
  const pathParams = extractRecord(request.args, [
    "pathParams",
    "path_parameters",
  ]);
  const queryParams = extractRecord(request.args, ["query", "queryParams"]);
  const headerParams = extractRecord(request.args, ["headers"]);

  const labelSources: unknown[] = [
    request.resourcePreview,
    request.args,
    (request.args as Record<string, unknown>)?.["body"],
  ];

  for (const entry of history) {
    const payload = extractToolJsonPayload(entry.tool_result);
    if (payload !== undefined) {
      labelSources.push(payload);
    }
  }

  const labelMap = buildLabelMap(...labelSources);

  const label =
    pickLabelFromRecord(request.resourcePreview) ??
    (typeof bodyData === "object" && bodyData !== null
      ? pickLabelFromRecord(bodyData as Record<string, unknown>)
      : undefined);

  const intro = label
    ? `I'm ready to ${action} **${label}**.`
    : `I'm ready to ${action} this resource.`;

  const sections: string[] = [];
  const changeNotes: string[] = [];

  const previousAttempt = [...history].reverse().find((entry) => {
    if (entry.tool_name !== "openapi.execute") {
      return false;
    }
    const args = entry.tool_args;
    if (!isPlainRecord(args)) {
      return false;
    }
    return args.operationId === request.operationId;
  });

  if (
    previousAttempt &&
    isErrorResult(previousAttempt.tool_result) &&
    isPlainRecord(previousAttempt.tool_args) &&
    isPlainRecord(request.args)
  ) {
    const errorMessage = extractErrorMessage(previousAttempt.tool_result);
    const diffNotes = collectDiffNotes(
      previousAttempt.tool_args as PlainRecord,
      request.args as PlainRecord
    );

    if (errorMessage) {
      changeNotes.push(`- Last attempt failed: ${errorMessage}`);
    }
    if (diffNotes.length) {
      changeNotes.push("- Updates since last attempt:");
      for (const note of diffNotes) {
        changeNotes.push(`  - ${note}`);
      }
    }

    if (changeNotes.length) {
      sections.push(`**What Changed**\n${changeNotes.join("\n")}`);
    }
  }

  const operationLines: string[] = [];
  if (request.operationId) {
    const operationTitle = formatOperationTitle(request.operationId);
    if (operationTitle.trim().length) {
      operationLines.push(`- Operation: ${operationTitle}`);
    } else {
      operationLines.push(`- Operation: ${request.operationId}`);
    }
  }
  if (request.path || request.method) {
    const endpoint = `${method}${
      request.path ? ` ${request.path}` : ""
    }`.trim();
    operationLines.push(`- Endpoint: \`${endpoint}\``);
  }
  if (operationLines.length) {
    sections.push(`**Operation**\n${operationLines.join("\n")}`);
  }

  if (hasRenderableData(request.resourcePreview)) {
    sections.push(
      `**Existing Resource**\n${formatData(
        request.resourcePreview,
        0,
        labelMap
      )}`
    );
  }

  if (hasRenderableData(bodyData)) {
    const title =
      method === "DELETE"
        ? "Target Details"
        : method === "POST"
        ? "Request Payload"
        : "Proposed Changes";
    sections.push(`**${title}**\n${formatData(bodyData, 0, labelMap)}`);
  }

  if (hasRenderableData(pathParams)) {
    sections.push(
      `**Path Parameters**\n${formatData(pathParams, 0, labelMap)}`
    );
  }

  if (hasRenderableData(queryParams)) {
    sections.push(
      `**Query Parameters**\n${formatData(queryParams, 0, labelMap)}`
    );
  }

  if (hasRenderableData(headerParams)) {
    sections.push(
      `**Custom Headers**\n${formatData(headerParams, 0, labelMap)}`
    );
  }

  const details = sections.length
    ? sections.join("\n\n")
    : "_No structured details available for review._";

  return `## 🔐 Pending Approval\n\n${intro}\n\n${details}\n\n---\n\nNothing has been executed yet. Click **Confirm** below to proceed or **Cancel** to abort.`;
}
