import { withToolLogging } from "../../../lib/metrics/store";
import { JSONValue, MCPResult, extractToolJsonPayload } from "../lib/utils";
import { collectGroundTruthNumbers } from "../analysis/validation";
import { summarizePayload, AssistantSummary } from "../analysis/aggregators";
import { validationManager } from "../lib/validation-manager";

export type ExecuteOutcome = {
  result?: unknown;
  payload?: JSONValue;
  truth?: Record<string, number>;
  summary?: AssistantSummary;
  error?: Record<string, unknown>;
  validationRequest?: {
    id: string;
    operationId: string;
    method: string;
    path: string;
    args: Record<string, unknown>;
    bodyFieldEnums?: Record<string, string[]>;
    bodyFieldReadOnly?: string[];
    resourcePreview?: Record<string, unknown>;
  };
};

function needsValidation(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (toolName !== "openapi.execute") {
    return false;
  }

  const operationId = args.operationId as string | undefined;
  if (!operationId) {
    return false;
  }

  // Check if operation starts with destructive method patterns
const destructivePatterns = [/^Admin(Post|Delete)/i, /^Store(Post|Delete)/i];

  return destructivePatterns.some((pattern) => pattern.test(operationId));
}

function extractOperationDetails(args: Record<string, unknown>): {
  operationId: string;
  method: string;
  path: string;
} {
  const operationId = args.operationId as string;

  // Extract method from operationId (e.g., AdminPostPromotions -> POST)
  const methodMatch = operationId.match(/Admin(Post|Delete|Put|Patch)/i);
  const inferredMethod = methodMatch ? methodMatch[1].toUpperCase() : "POST";

  // Simple path extraction (this could be improved with actual operation lookup)
  const path = `/admin/${operationId
    .replace(/^Admin(Post|Delete|Put|Patch)/i, "")
    .toLowerCase()}`;

  return { operationId, method: inferredMethod, path };
}

const SUMMARY_FIELD_PRIORITY = [
  "code",
  "title",
  "name",
  "handle",
  "sku",
  "email",
  "status",
  "type",
  "currency_code",
  "region_id",
  "sales_channel_id",
  "campaign_id",
  "starts_at",
  "ends_at",
];

const FALLBACK_SUMMARY_LIMIT = 6;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractPathParams = (
  args: Record<string, unknown>
): Record<string, unknown> | undefined => {
  const candidate = args.pathParams ?? args.path_parameters;
  if (isPlainRecord(candidate)) {
    return candidate;
  }
  return undefined;
};

const derivePreviewOperationId = (operationId: string): string | null => {
  const match = operationId.match(/^(Admin|Store)(Post|Put|Patch|Delete)(.+)$/);
  if (!match) {
    return null;
  }
  return `${match[1]}Get${match[3]}`;
};

const chooseEntityCandidate = (
  payload: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if ("data" in payload) {
    const data = payload.data;
    if (isPlainRecord(data)) {
      if (typeof data.id === "string" || typeof data.id === "number") {
        return data;
      }
      const nestedEntries = Object.values(data).filter((value) =>
        isPlainRecord(value)
      ) as Record<string, unknown>[];
      if (nestedEntries.length) {
        return nestedEntries.find((entry) => "id" in entry) ?? nestedEntries[0];
      }
    }
  }

  if (typeof payload.id === "string" || typeof payload.id === "number") {
    return payload;
  }

  const directEntries = Object.values(payload).filter((value) =>
    isPlainRecord(value)
  ) as Record<string, unknown>[];

  return directEntries.find((entry) => "id" in entry) ?? directEntries[0];
};

const summarizeEntity = (
  entity: Record<string, unknown>
): Record<string, unknown> => {
  const summary: Record<string, unknown> = {};

  if (entity.id !== undefined) {
    summary.id = entity.id;
  }

  for (const key of SUMMARY_FIELD_PRIORITY) {
    const value = entity[key];
    if (
      value !== undefined &&
      value !== null &&
      !(key in summary) &&
      typeof value !== "object"
    ) {
      summary[key] = value;
    }
  }

  if (Object.keys(summary).length > 1) {
    return summary;
  }

  for (const [key, value] of Object.entries(entity)) {
    if (Object.keys(summary).length >= FALLBACK_SUMMARY_LIMIT) {
      break;
    }
    if (summary[key] !== undefined) {
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object") {
      continue;
    }
    summary[key] = value;
  }

  return summary;
};

async function buildResourcePreview(params: {
  mcp: MCPResult;
  operationId: string;
  args: Record<string, unknown>;
}): Promise<Record<string, unknown> | undefined> {
  const { mcp, operationId, args } = params;
  const previewOperationId = derivePreviewOperationId(operationId);
  if (!previewOperationId) {
    return undefined;
  }

  const pathParams = extractPathParams(args);
  if (!pathParams || Object.keys(pathParams).length === 0) {
    return undefined;
  }

  try {
    const previewResult = await mcp.callTool("openapi.execute", {
      operationId: previewOperationId,
      pathParams,
      schemaAware: true,
    });

    const parsedPayload = extractToolJsonPayload(previewResult);
    const basePayload = isPlainRecord(parsedPayload)
      ? parsedPayload
      : isPlainRecord(previewResult)
      ? (previewResult as Record<string, unknown>)
      : undefined;

    if (!basePayload) {
      return undefined;
    }

    const entity = chooseEntityCandidate(basePayload);
    if (!entity) {
      return undefined;
    }

    return summarizeEntity(entity);
  } catch (error) {
    console.warn(
      `  Could not fetch preview for ${operationId} (${previewOperationId}):`,
      error
    );
    return undefined;
  }
}

export async function executeTool(params: {
  mcp: MCPResult;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<ExecuteOutcome> {
  const { mcp, toolName, args } = params;

  // Check if this operation needs validation
  if (needsValidation(toolName, args)) {
    const details = extractOperationDetails(args);
    let operationMethod = details.method;
    let operationPath = details.path;

    // Fetch schema information including enums and readOnly fields
    let bodyFieldEnums: Record<string, string[]> | undefined;
    let bodyFieldReadOnly: string[] | undefined;
    try {
      const schemaResult = await mcp.callTool("openapi.schema", {
        operationId: details.operationId,
      });

      if (schemaResult?.content?.[0]?.text) {
        const schemaData = JSON.parse(schemaResult.content[0].text);
        bodyFieldEnums = schemaData.bodyFieldEnums || {};
        bodyFieldReadOnly = schemaData.bodyFieldReadOnly || [];
        if (typeof schemaData.method === "string" && schemaData.method.length) {
          operationMethod = schemaData.method.toUpperCase();
        }
        if (typeof schemaData.path === "string" && schemaData.path.length) {
          operationPath = schemaData.path;
        }
      }
    } catch (error) {
      console.warn(
        `   Could not fetch schema for ${details.operationId}:`,
        error
      );
    }

    const resourcePreview = await buildResourcePreview({
      mcp,
      operationId: details.operationId,
      args,
    });

    const { request } = validationManager.createValidationRequest(
      details.operationId,
      operationMethod,
      operationPath,
      args,
      bodyFieldEnums,
      bodyFieldReadOnly,
      resourcePreview
    );

    // Return early with validation request
    return {
      validationRequest: {
        id: request.id,
        operationId: request.operationId,
        method: request.method,
        path: request.path,
        args: request.args,
        bodyFieldEnums: request.bodyFieldEnums,
        bodyFieldReadOnly: request.bodyFieldReadOnly,
        resourcePreview: request.resourcePreview,
      },
    };
  }

  try {
    const result = await withToolLogging(toolName, args, async () => {
      return mcp.callTool(toolName, args);
    });

    const payload = extractToolJsonPayload(result);
    const truth = collectGroundTruthNumbers(payload);
    const summary = summarizePayload(payload);

    if (summary) {
      const resultObj = result as MCPResult;
      const textEntry = {
        type: "text" as const,
        text: JSON.stringify({ assistant_summary: summary }),
      };
      if (Array.isArray(resultObj?.content)) {
        resultObj.content.push(textEntry);
      } else if (resultObj) {
        (resultObj as unknown as { content: unknown[] }).content = [textEntry];
      }
    }

    return { result, payload, truth, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`   Tool ${toolName} failed: ${message}`);

    const toolError: Record<string, unknown> = {
      error: true,
      message,
    };

    const maybeCode = (error as { code?: unknown })?.code;
    if (typeof maybeCode === "number" || typeof maybeCode === "string") {
      toolError.code = maybeCode;
    }

    const maybeData = (error as { data?: unknown })?.data;
    if (maybeData !== undefined) {
      toolError.data = maybeData;
    }

    const maybeResult = (error as { result?: unknown })?.result;
    if (maybeResult !== undefined) {
      toolError.result = maybeResult;
    }

    return { error: toolError };
  }
}
