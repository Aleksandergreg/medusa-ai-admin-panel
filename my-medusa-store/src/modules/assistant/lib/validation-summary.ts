import { extractToolJsonPayload } from "./utils";
import { HistoryEntry } from "./types";
import { ValidationRequest } from "./validation-types";
import { buildLabelMap, pickLabelFromRecord } from "./label-utils";
import {
  extractRecord,
  formatData,
  hasRenderableData,
  normalizeBodyForDisplay,
} from "./formatters";

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
  const pathParams = extractRecord(request.args, ["pathParams", "path_parameters"]);
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

  const operationLines: string[] = [];
  if (request.operationId) {
    operationLines.push(`- Operation: \`${request.operationId}\``);
  }
  if (request.path || request.method) {
    const endpoint = `${method}${request.path ? ` ${request.path}` : ""}`.trim();
    operationLines.push(`- Endpoint: \`${endpoint}\``);
  }
  if (operationLines.length) {
    sections.push(`**Operation**\n${operationLines.join("\n")}`);
  }

  if (hasRenderableData(request.resourcePreview)) {
    sections.push(`**Existing Resource**\n${formatData(request.resourcePreview, 0, labelMap)}`);
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
    sections.push(`**Path Parameters**\n${formatData(pathParams, 0, labelMap)}`);
  }

  if (hasRenderableData(queryParams)) {
    sections.push(`**Query Parameters**\n${formatData(queryParams, 0, labelMap)}`);
  }

  if (hasRenderableData(headerParams)) {
    sections.push(`**Custom Headers**\n${formatData(headerParams, 0, labelMap)}`);
  }

  const details = sections.length
    ? sections.join("\n\n")
    : "_No structured details available for review._";

  return `## 🔐 Pending Approval\n\n${intro}\n\n${details}\n\n---\n\nNothing has been executed yet. Click **Confirm** below to proceed or **Cancel** to abort.`;
}

