import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { validationManager } from "../../../../modules/assistant/lib/validation-manager";
import { getMcp } from "../../../../lib/mcp/manager";
import AssistantModuleService from "../../../../modules/assistant/service";

// Define the expected session structure
interface SessionWithAuthContext {
  auth_context?: {
    actor_id?: string;
  };
}

// Type guard for session
function hasAuthContext(session: unknown): session is SessionWithAuthContext {
  return (
    typeof session === "object" &&
    session !== null &&
    "auth_context" in session &&
    typeof (session as Record<string, unknown>).auth_context === "object" &&
    (session as Record<string, unknown>).auth_context !== null
  );
}

function getActorId(req: AuthenticatedMedusaRequest): string | null {
  const fromAuthContext = req.auth_context?.actor_id;
  if (fromAuthContext) {
    return fromAuthContext;
  }

  let sessionActor: string | undefined;
  if (hasAuthContext(req.session)) {
    sessionActor = req.session.auth_context?.actor_id;
  }
  if (sessionActor && typeof sessionActor === "string" && sessionActor.trim()) {
    return sessionActor;
  }

  const legacyUserId = (req as unknown as Record<string, unknown>)?.user as
    | { id?: string }
    | undefined;
  if (
    legacyUserId?.id &&
    typeof legacyUserId.id === "string" &&
    legacyUserId.id.trim()
  ) {
    return legacyUserId.id;
  }

  return null;
}

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

const isToolExecutionResult = (
  value: unknown
): value is ToolExecutionResult => {
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

const normalizeErrorMessage = (
  raw: string | null,
  fallback: string
): string => {
  if (!raw) {
    return fallback;
  }

  const trimmed = raw.replace(/^Error:\s*/i, "").trim();
  return trimmed.length ? trimmed : fallback;
};

const generateSuccessMessage = (
  validation: {
    method: string;
    path: string;
    operationId: string;
    args: Record<string, unknown>;
  },
  payload: OpenApiExecutionPayload | null
): string => {
  const method = validation.method.toUpperCase();
  const data = payload?.data;

  // Determine action type
  let action = "modified";
  if (method === "POST") {
    action = "created";
  } else if (method === "DELETE") {
    action = "deleted";
  } else if (method === "PUT" || method === "PATCH") {
    action = "updated";
  }

  // Extract resource type from path or operationId
  let resourceType = "item";
  const pathMatch = validation.path.match(/\/admin\/([^/]+)/);
  if (pathMatch) {
    resourceType = pathMatch[1].replace(/-/g, " ");
  }

  // Build the message
  let message = `## ✅ Successfully ${action} ${resourceType}\n\n`;

  // Add details about what was created/deleted/updated
  if (data && typeof data === "object") {
    message += "**Details:**\n\n";

    // Format the data in a readable way
    const formatValue = (value: unknown): string => {
      if (value === null || value === undefined) return "N/A";
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (typeof value === "object" && !Array.isArray(value)) {
        return JSON.stringify(value, null, 2);
      }
      if (Array.isArray(value)) {
        return value.map((v) => formatValue(v)).join(", ");
      }
      return String(value);
    };

    // Key fields to display prominently
    const importantFields = [
      "id",
      "code",
      "title",
      "name",
      "type",
      "value",
      "handle",
      "status",
      "discount",
      "amount",
    ];
    const displayedFields = new Set<string>();

    // Show important fields first
    for (const field of importantFields) {
      if (field in data) {
        const value = (data as Record<string, unknown>)[field];
        message += `- **${
          field.charAt(0).toUpperCase() + field.slice(1)
        }**: ${formatValue(value)}\n`;
        displayedFields.add(field);
      }
    }

    // Show other fields
    const otherFields = Object.keys(data).filter(
      (key) => !displayedFields.has(key) && !key.startsWith("_")
    );
    if (otherFields.length > 0) {
      message += "\n**Additional Fields:**\n\n";
      for (const field of otherFields.slice(0, 10)) {
        // Limit to 10 additional fields
        const value = (data as Record<string, unknown>)[field];
        message += `- **${
          field.charAt(0).toUpperCase() + field.slice(1)
        }**: ${formatValue(value)}\n`;
      }
    }
  }

  message +=
    "\n\nThe operation has been completed successfully. You can continue with your next task.";

  return message;
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

      // Save rejection message to conversation history
      const rejectionMessage =
        "## ❌ Action Cancelled\n\nNo changes were made to your store. The operation has been cancelled as requested.\n\nFeel free to ask me to do something else!";

      const actorId = getActorId(req);
      if (actorId) {
        try {
          const assistantService: AssistantModuleService =
            req.scope.resolve("assistant");

          // Update the last message (which has the user's question) with the rejection answer
          await assistantService.updateLastMessageAnswer(
            actorId,
            rejectionMessage
          );

          console.log("Successfully saved rejection message to database");
        } catch (err) {
          console.error(
            "Failed to save rejection message to conversation:",
            err
          );
        }
      }

      return res.json({
        status: "rejected",
        message: rejectionMessage,
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
      console.log("Original args:", JSON.stringify(validation.args, null, 2));
      console.log("Edited data:", JSON.stringify(editedData, null, 2));

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
        typeof statusCode === "number" && statusCode >= 400 ? statusCode : 400;

      return res.status(httpStatus).json({
        status: "failed",
        error: errorMessage,
        result: toolResult,
      });
    }

    // Mark validation as approved
    validationManager.respondToValidation({ id, approved: true });

    // Generate a descriptive success message
    const successMessage = generateSuccessMessage(validation, payload);

    // Save the success message to the conversation history
    const actorId = getActorId(req);
    if (actorId) {
      try {
        const assistantService: AssistantModuleService =
          req.scope.resolve("assistant");

        // Update the last message (which has the user's question) with the success answer
        await assistantService.updateLastMessageAnswer(actorId, successMessage);

        console.log("Successfully saved success message to database");
      } catch (err) {
        console.error("Failed to save success message to conversation:", err);
        // Don't fail the request if we can't save to history
      }
    }

    return res.json({
      status: "approved",
      result,
      message: successMessage,
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
