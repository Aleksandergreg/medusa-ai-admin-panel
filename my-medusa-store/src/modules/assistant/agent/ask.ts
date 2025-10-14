import { getMcp } from "../../../lib/mcp/manager";
import { metricsStore } from "../../../lib/metrics/store";
import {
  normalizeToolArgs,
  ensureMarkdownMinimum,
  extractToolJsonPayload,
} from "../lib/utils";
import { FALLBACK_MESSAGE } from "../lib/plan-normalizer";
import { HistoryEntry, InitialOperation, McpTool } from "../lib/types";
import { AssistantModuleOptions } from "../config";
import { preloadOpenApiSuggestions } from "./preload";
import { executeTool, ExecuteOutcome } from "./tool-executor";
import { HistoryTracker, isMutatingExecuteCall } from "./history-tracker";
import { planNextAction } from "./planner-driver";
import {
  ValidationContinuationHandler,
  ValidationContinuationPayload,
  ValidationContinuationResult,
  ValidationRequest,
} from "../lib/validation-types";

type AskInput = {
  prompt: string;
  history?: HistoryEntry[];
  onCancel?: (cancel: () => void) => void;
};

type AgentResult = ValidationContinuationResult;

type ToolSuccessContext = {
  outcome: ExecuteOutcome;
  toolName: string;
  args: Record<string, unknown>;
  cacheable: boolean;
};

const LABEL_CANDIDATE_KEYS = [
  "name",
  "title",
  "handle",
  "code",
  "sku",
  "display_name",
  "label",
];

type ValidationSummaryRequest = Pick<
  ValidationRequest,
  | "id"
  | "operationId"
  | "method"
  | "path"
  | "args"
  | "bodyFieldEnums"
  | "bodyFieldReadOnly"
  | "resourcePreview"
>;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasRenderableData = (value: unknown): boolean => {
  if (value === undefined) return false;
  if (value === null) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasRenderableData(item));
  }
  if (isPlainRecord(value)) {
    return Object.values(value).some((entry) => hasRenderableData(entry));
  }
  return true;
};

const prettifyKey = (key: string): string =>
  key
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatPrimitive = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : '""';
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const resolveLabel = (
  raw: unknown,
  labelMap: Map<string, string>
): string | undefined => {
  if (typeof raw !== "string") {
    return undefined;
  }
  const direct = labelMap.get(raw);
  if (direct) {
    return direct;
  }
  return undefined;
};

const formatArray = (
  values: unknown[],
  indent: number,
  labelMap: Map<string, string>
): string => {
  if (!values.length) {
    return `${"  ".repeat(indent)}- (none)`;
  }

  return values
    .map((item) => {
      const prefix = `${"  ".repeat(indent)}- `;
      if (isPlainRecord(item)) {
        const nested = formatRecord(item, indent + 1, labelMap);
        return `${prefix}Item\n${nested}`;
      }
      if (Array.isArray(item)) {
        const nested = formatArray(item, indent + 1, labelMap);
        return `${prefix}Items\n${nested}`;
      }
      if (typeof item === "string") {
        const label = resolveLabel(item, labelMap);
        if (label && label !== item) {
          return `${prefix}${label} (${item})`;
        }
      }
      return `${prefix}${formatPrimitive(item)}`;
    })
    .join("\n");
};

const formatRecord = (
  record: Record<string, unknown>,
  indent = 0,
  labelMap: Map<string, string>
): string => {
  const entries = Object.entries(record).filter(([, value]) =>
    hasRenderableData(value)
  );
  if (!entries.length) {
    return `${"  ".repeat(indent)}- (empty)`;
  }

  return entries
    .map(([key, value]) => {
      const prefix = `${"  ".repeat(indent)}- **${prettifyKey(key)}**`;
      if (isPlainRecord(value)) {
        const nested = formatRecord(value, indent + 1, labelMap);
        return `${prefix}\n${nested}`;
      }
      if (Array.isArray(value)) {
        const nested = formatArray(value, indent + 1, labelMap);
        return `${prefix}\n${nested}`;
      }
      if (typeof value === "string") {
        const label = resolveLabel(value, labelMap);
        if (label && label !== value) {
          return `${prefix}: ${label} (${value})`;
        }
      }
      return `${prefix}: ${formatPrimitive(value)}`;
    })
    .join("\n");
};

const formatData = (
  value: unknown,
  indent = 0,
  labelMap: Map<string, string>
): string => {
  if (Array.isArray(value)) {
    return formatArray(value, indent, labelMap);
  }
  if (isPlainRecord(value)) {
    return formatRecord(value, indent, labelMap);
  }
  if (!hasRenderableData(value)) {
    return "";
  }
  if (typeof value === "string") {
    const label = resolveLabel(value, labelMap);
    if (label && label !== value) {
      return `${"  ".repeat(indent)}- ${label} (${value})`;
    }
  }
  return `${"  ".repeat(indent)}- ${formatPrimitive(value)}`;
};

const extractRecord = (
  source: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> | undefined => {
  for (const key of keys) {
    const candidate = source[key];
    if (isPlainRecord(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const pickLabelFromRecord = (
  record: Record<string, unknown> | undefined
): string | undefined => {
  if (!record) {
    return undefined;
  }

  for (const key of LABEL_CANDIDATE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate.trim();
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
    if (isPlainRecord(value)) {
      const nested = pickLabelFromRecord(value);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
};

const normalizeBodyForDisplay = (value: unknown): unknown => {
  if (value === undefined) {
    return undefined;
  }
  if (isPlainRecord(value) || Array.isArray(value)) {
    return value;
  }
  return { Value: value };
};

const trimLabel = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
};

const looksLikeResourceId = (value: string): boolean =>
  /^[a-z]+_[0-9A-Za-z]+$/.test(value);

type LabelCollection = {
  map: Map<string, string>;
  unresolved: Set<string>;
};

const registerLabel = (
  id: string,
  label: string,
  collection: LabelCollection
) => {
  const cleanLabel = label.trim();
  if (!cleanLabel) {
    return;
  }
  collection.map.set(id, cleanLabel);
  collection.unresolved.delete(id);
};

const markUnresolved = (id: string, collection: LabelCollection) => {
  if (!collection.map.has(id)) {
    collection.unresolved.add(id);
  }
};

const collectLabels = (value: unknown, collection: LabelCollection): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && looksLikeResourceId(entry)) {
        markUnresolved(entry, collection);
      }
      collectLabels(entry, collection);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    if (typeof value === "string" && looksLikeResourceId(value)) {
      markUnresolved(value, collection);
    }
    return;
  }

  const candidateId = value.id;
  if (typeof candidateId === "string") {
    for (const key of LABEL_CANDIDATE_KEYS) {
      const label = trimLabel(value[key]);
      if (label && label !== candidateId) {
        registerLabel(candidateId, label, collection);
        break;
      }
    }
    if (!collection.map.has(candidateId)) {
      markUnresolved(candidateId, collection);
    }
  }

  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && looksLikeResourceId(raw)) {
      if (key.endsWith("_id")) {
        const base = key.slice(0, -3);
        if (base) {
          const candidates = [
            `${base}_name`,
            `${base}_title`,
            `${base}_label`,
            `${base}_code`,
            `${base}_handle`,
          ];
          for (const labelKey of candidates) {
            const sibling = trimLabel(value[labelKey]);
            if (sibling && sibling !== raw) {
              registerLabel(raw, sibling, collection);
              break;
            }
          }
        }
      }
      markUnresolved(raw, collection);
    }
    collectLabels(raw, collection);
  }
};

const applyProductLabels = (
  products: unknown,
  collection: LabelCollection
) => {
  if (!Array.isArray(products)) {
    return;
  }

  for (const entry of products) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    const id = trimLabel(entry.id);
    if (!id) {
      continue;
    }
    const labelCandidateKeys = [
      "title",
      "name",
      "handle",
      "code",
      "display_name",
    ] as const;
    let label: string | undefined;
    for (const key of labelCandidateKeys) {
      const candidate = trimLabel(entry[key]);
      if (candidate) {
        label = candidate;
        break;
      }
    }
    if (label) {
      registerLabel(id, label, collection);
    }
  }
};

const enrichLabelsFromMcp = async (
  mcp: unknown,
  collection: LabelCollection
): Promise<void> => {
  if (!collection.unresolved.size || !mcp) {
    return;
  }

  const unresolvedIds = Array.from(collection.unresolved);
  const productIds = unresolvedIds.filter((id) => id.startsWith("prod_"));

  if (productIds.length) {
    try {
      const result = await (mcp as { callTool: Function }).callTool(
        "openapi.execute",
        {
          operationId: "AdminGetProducts",
          query: {
            id: productIds.length === 1 ? productIds[0] : productIds,
            fields: "id,title,name,handle",
          },
        }
      );
      const payload = extractToolJsonPayload(result);
      if (isPlainRecord(payload)) {
        if (Array.isArray((payload as Record<string, unknown>).products)) {
          applyProductLabels(
            (payload as Record<string, unknown>).products,
            collection
          );
        } else if (Array.isArray((payload as Record<string, unknown>).data)) {
          applyProductLabels(
            (payload as Record<string, unknown>).data,
            collection
          );
        }
      }
    } catch (error) {
      console.warn(
        "   Could not batch fetch product labels for validation summary:",
        error
      );
    }

    const remaining = productIds.filter((id) => collection.unresolved.has(id));
    for (const id of remaining) {
      try {
        const result = await (mcp as { callTool: Function }).callTool(
          "openapi.execute",
          {
            operationId: "AdminGetProductsId",
            pathParams: { id },
            schemaAware: true,
          }
        );
        const payload = extractToolJsonPayload(result);
        if (isPlainRecord(payload)) {
          const product =
            (payload as Record<string, unknown>).product ??
            (payload as Record<string, unknown>).data;
          if (isPlainRecord(product)) {
            applyProductLabels([product], collection);
          }
        }
      } catch (error) {
        console.warn(
          `   Could not fetch product label for ${id} in validation summary:`,
          error
        );
      }
    }
  }
};

const buildLabelMap = async (
  mcp: unknown,
  ...sources: unknown[]
): Promise<Map<string, string>> => {
  const collection: LabelCollection = {
    map: new Map<string, string>(),
    unresolved: new Set<string>(),
  };

  for (const source of sources) {
    collectLabels(source, collection);
  }

  await enrichLabelsFromMcp(mcp, collection);

  return collection.map;
};

const buildValidationSummaryMessage = (
  request: ValidationSummaryRequest,
  labelMap: Map<string, string>
): string => {
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

  const label =
    pickLabelFromRecord(request.resourcePreview) ??
    (isPlainRecord(bodyData) ? pickLabelFromRecord(bodyData) : undefined);

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
};

export async function askAgent(
  input: AskInput,
  options: { config: AssistantModuleOptions }
): Promise<AgentResult> {
  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error("Missing prompt");
  }

  const mcp = await getMcp();
  const tools = await mcp.listTools();
  const availableTools: McpTool[] = (tools.tools ?? []) as McpTool[];

  const initialOperations: InitialOperation[] = await preloadOpenApiSuggestions(
    prompt,
    mcp,
    availableTools
  );

  const historyTracker = new HistoryTracker(input.history || []);
  const turnId = metricsStore.startAssistantTurn({ user: prompt });

  let isCancelled = false;
  if (typeof input.onCancel === "function") {
    input.onCancel(() => {
      isCancelled = true;
    });
  }

  const handleSuccessfulExecution = ({
    outcome,
    toolName,
    args,
    cacheable,
  }: ToolSuccessContext) => {
    const result = outcome.result;
    console.log(`   Tool Result: ${JSON.stringify(result).substring(0, 200)}...`);

    if (outcome.truth) {
      metricsStore.provideGroundTruth(turnId, outcome.truth);
    }

    if (outcome.summary) {
      const summaryNumbers: Record<string, number> = {};
      for (const aggregate of outcome.summary.aggregates) {
        for (const entry of aggregate.counts) {
          summaryNumbers[`${aggregate.path}:${entry.value}`] = entry.count;
        }
        summaryNumbers[`${aggregate.path}:__total__`] = aggregate.total;
      }
      if (Object.keys(summaryNumbers).length) {
        metricsStore.provideGroundTruth(turnId, summaryNumbers);
      }
    }

    historyTracker.recordResult(toolName, args, result, cacheable);

    if (outcome.summary) {
      historyTracker.recordSummary(toolName, outcome.summary);
    }
  };

  const runLoop = async (step: number): Promise<AgentResult> => {
    if (isCancelled) {
      throw new Error("Request was cancelled by the client.");
    }

    if (step >= options.config.maxSteps) {
      metricsStore.endAssistantTurn(turnId, "[aborted: max steps exceeded]");
      throw new Error(
        "The agent could not complete the request within the maximum number of steps."
      );
    }

    console.log(`\n--- AGENT LOOP: STEP ${step + 1} ---`);

    const { plan, rawPlan } = await planNextAction({
      prompt,
      tools: availableTools,
      history: historyTracker.list,
      modelName: options.config.modelName,
      initialOperations,
      config: options.config,
    });

    if (!plan) {
      console.warn("Planner returned an unrecognized plan", rawPlan);
      metricsStore.endAssistantTurn(turnId, FALLBACK_MESSAGE);
      return {
        answer: FALLBACK_MESSAGE,
        data: null,
        history: historyTracker.list,
      };
    }

    if (plan.action === "final_answer") {
      const chosenAnswer =
        plan.answer && plan.answer.trim().length
          ? plan.answer
          : FALLBACK_MESSAGE;

      metricsStore.endAssistantTurn(turnId, chosenAnswer);

      const t = metricsStore.getLastTurn?.();
      const grounded = t?.groundedNumbers ?? {};
      for (const [label, value] of Object.entries(grounded)) {
        if (typeof value === "number") {
          metricsStore.autoValidateFromAnswer(turnId, label, value, 0);
        }
      }

      const latestPayload = historyTracker.latestPayload();
      const formattedAnswer = ensureMarkdownMinimum(chosenAnswer);

      return {
        answer: formattedAnswer,
        data: latestPayload ?? null,
        history: historyTracker.list,
      };
    }

    if (plan.action !== "call_tool" || !plan.tool_name || !plan.tool_args) {
      throw new Error("AI returned an invalid plan. Cannot proceed.");
    }

    const toolName = plan.tool_name;
    console.log(`  AI wants to call tool: ${toolName}`);
    console.log(`   With args: ${JSON.stringify(plan.tool_args)}`);

    const normalizedArgs = normalizeToolArgs(plan.tool_args);
    if (JSON.stringify(normalizedArgs) !== JSON.stringify(plan.tool_args)) {
      console.log(`   Normalized args: ${JSON.stringify(normalizedArgs)}`);
    }

    const cacheable =
      toolName === "openapi.execute" && isMutatingExecuteCall(normalizedArgs);
    const previousSuccess = historyTracker.getCachedSuccess(
      toolName,
      normalizedArgs,
      cacheable
    );

    if (previousSuccess) {
      console.log(
        "   Duplicate tool call detected; reusing prior successful result."
      );
      historyTracker.recordDuplicate(toolName);
      return runLoop(step + 1);
    }

    metricsStore.noteToolUsed(turnId, toolName);

    const outcome = await executeTool(
      {
        mcp,
        toolName,
        args: normalizedArgs as Record<string, unknown>,
      },
      { skipValidation: false }
    );

    if (outcome.validationRequest) {
      console.log(`    Validation required for operation`);

      const labelSources: unknown[] = [
        outcome.validationRequest.resourcePreview,
        outcome.validationRequest.args,
        (
          outcome.validationRequest.args as Record<string, unknown>
        )?.["body"],
      ];

      for (const entry of historyTracker.list) {
        const payload = extractToolJsonPayload(entry.tool_result);
        if (payload !== undefined) {
          labelSources.push(payload);
        }
      }

      const labelMap = await buildLabelMap(mcp, ...labelSources);

      const validationMessage = buildValidationSummaryMessage(
        outcome.validationRequest,
        labelMap
      );

      const continuation: ValidationContinuationHandler = async (
        payload: ValidationContinuationPayload
      ) => {
        if (!payload.approved) {
          return {
            answer: validationMessage,
            data: outcome.validationRequest,
            history: historyTracker.list,
          };
        }

        const argsToExecute = normalizedArgs;

        const resumedOutcome = await executeTool(
          {
            mcp,
            toolName,
            args: argsToExecute as Record<string, unknown>,
          },
          { skipValidation: true }
        );

        if (resumedOutcome.error) {
          historyTracker.recordError(toolName, argsToExecute, resumedOutcome.error);
          return runLoop(step + 1);
        }

        handleSuccessfulExecution({
          outcome: resumedOutcome,
          toolName,
          args: argsToExecute as Record<string, unknown>,
          cacheable,
        });

        return runLoop(step + 1);
      };

      return {
        answer: validationMessage,
        data: outcome.validationRequest,
        history: historyTracker.list,
        validationRequest: outcome.validationRequest,
        continuation,
      };
    }

    if (outcome.error) {
      historyTracker.recordError(toolName, normalizedArgs, outcome.error);
      return runLoop(step + 1);
    }

    handleSuccessfulExecution({
      outcome,
      toolName,
      args: normalizedArgs as Record<string, unknown>,
      cacheable,
    });

    return runLoop(step + 1);
  };

  return runLoop(0);
}
