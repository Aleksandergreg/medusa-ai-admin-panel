import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { validationManager } from "../../../../modules/assistant/lib/validation-manager";
import { getMcp } from "../../../../lib/mcp/manager";

type ToolContentEntry = {
  type?: string;
  text?: string;
  [k: string]: unknown;
};

type ToolExecutionResult = {
  content?: ToolContentEntry[];
  isError?: boolean;
  [k: string]: unknown;
};

type OpenApiExecutionPayload = {
  status?: string;
  statusCode?: number;
  data?: Record<string, unknown>;
  [k: string]: unknown;
};

type ValidationResponsePayload = {
  id: string;
  approved: boolean;
  editedData?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isToolContentEntry = (value: unknown): value is ToolContentEntry => {
  if (!isRecord(value)) {
    return false;
  }

  const { type, text } = value as { type?: unknown; text?: unknown };
  if (type !== undefined && typeof type !== "string") {
    return false;
  }
  if (text !== undefined && typeof text !== "string") {
    return false;
  }
  return true;
};

const isToolExecutionResult = (value: unknown): value is ToolExecutionResult => {
  if (!isRecord(value)) {
    return false;
  }

  const isError = (value as { isError?: unknown }).isError;
  if (isError !== undefined && typeof isError !== "boolean") {
    return false;
  }

  if ("content" in value) {
    const content = (value as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return false;
    }
    if (!content.every(isToolContentEntry)) {
      return false;
    }
  }

  return true;
};

const getFirstTextContent = (result: ToolExecutionResult): string | null => {
  if (!result?.content || !Array.isArray(result.content)) {
    return null;
  }

  for (const entry of result.content) {
    if (
      entry &&
      typeof entry === "object" &&
      entry.type === "text" &&
      typeof entry.text === "string"
    ) {
      return entry.text;
    }
  }

  return null;
};

const safeParseJson = <T>(value: string | null): T | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const normalizeErrorMessage = (raw: string | null, fallback: string): string => {
  if (!raw) {
    return fallback;
  }

  const trimmed = raw.replace(/^Error:\s*/i, "").trim();
  return trimmed.length ? trimmed : fallback;
};

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const { id, approved, editedData } =
      (req.body as ValidationResponsePayload) ?? {};

    if (!id || typeof id !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or invalid validation id" });
    }

    if (typeof approved !== "boolean") {
      return res
        .status(400)
        .json({ error: "Missing or invalid approved flag" });
    }

    if (!validationManager.hasPendingValidation(id)) {
      return res
        .status(404)
        .json({ error: "Validation request not found or expired" });
    }

    if (!approved) {
      // User rejected the operation
      validationManager.respondToValidation({ id, approved: false });
      return res.json({
        status: "rejected",
        message: "Operation was rejected by user",
      });
    }

    // User approved - execute the operation
    const validations = validationManager.getPendingValidations();
    const validation = validations.find((v) => v.id === id);

    if (!validation) {
      return res.status(404).json({ error: "Validation request not found" });
    }

    // Execute the actual operation with edited data if provided
    const mcp = await getMcp();
    let argsToExecute = validation.args;

    if (editedData) {

      // Replace the body content with edited data
      argsToExecute = {
        ...validation.args,
        body: editedData,
      };

      console.log("Args to execute:", JSON.stringify(argsToExecute, null, 2));
    }

    const result = await mcp.callTool("openapi.execute", argsToExecute);

    if (!isToolExecutionResult(result)) {
      console.error("Unexpected tool result shape:", result);
      validationManager.respondToValidation({ id, approved: false });
      return res.status(502).json({
        status: "failed",
        error: "Unexpected response from assistant execution.",
      });
    }

    const toolResult = result;
    const textContent = getFirstTextContent(toolResult);
    const payload = safeParseJson<OpenApiExecutionPayload>(textContent);
    const statusCode =
      typeof payload?.statusCode === "number" ? payload.statusCode : undefined;
    const isErrorResult = Boolean(toolResult?.isError);
    const isFailureStatus =
      typeof statusCode === "number" && statusCode >= 400 && statusCode <= 599;

    if (isErrorResult || isFailureStatus) {
      const defaultMessage = "Unable to execute the requested operation.";
      const dataMessage =
        payload?.data && typeof payload.data === "object"
          ? (payload.data as { message?: unknown }).message
          : undefined;

      const errorMessage =
        typeof dataMessage === "string" && dataMessage.trim().length
          ? dataMessage.trim()
          : normalizeErrorMessage(textContent, defaultMessage);

      validationManager.respondToValidation({ id, approved: false });

      const httpStatus =
        typeof statusCode === "number" && statusCode >= 400
          ? statusCode
          : 400;

      return res.status(httpStatus).json({
        status: "failed",
        error: errorMessage,
        result: toolResult,
      });
    }

    // Mark validation as approved
    validationManager.respondToValidation({ id, approved: true });

    return res.json({
      status: "approved",
      result,
    });
  } catch (e: unknown) {
    console.error("\n--- Validation Route Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const pending = validationManager.getPendingValidations();
    return res.json({ validations: pending });
  } catch (e: unknown) {
    console.error("\n--- Validation Route Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
