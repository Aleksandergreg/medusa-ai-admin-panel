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

const generateSuccessMessage = async (
  payload: OpenApiExecutionPayload | null,
  assistantService: AssistantModuleService,
  actorId: string
): Promise<string | null> => {
  try {
    // Get the user's last message to understand the original intent
    const conversation = await assistantService.getConversation(actorId);
    const lastUserMessage = conversation?.history
      .slice()
      .reverse()
      .find((entry) => entry.role === "user");

    const resultData = payload?.data
      ? JSON.stringify(payload.data, null, 2)
      : "No data returned";

    // Create a prompt asking the AI to summarize the result naturally
    // The AI will determine what action was performed based on the context
    const prompt = `The user's request was successfully handled.
Original request: "${lastUserMessage?.content || "An operation"}"
Result data:
\`\`\`json
${resultData}
\`\`\`
Please provide a brief, natural, human-friendly summary (2-4 sentences) of what was successfully done, highlighting only the most important details. Be conversational and concise. Start with a success emoji (e.g., ✅ or 🎉).`;

    // Use the assistant service to generate a natural response.
    // A temporary actorId is used to ensure this summarization step doesn't get saved to the user's main chat history.
    const result = await assistantService.prompt({
      prompt,
      actorId: `${actorId}_summary`,
    });

    if (result.answer && !result.answer.includes("Sorry")) {
      return result.answer;
    }
  } catch (err) {
    console.error("Failed to generate AI summary:", err);
  }

  // Return null if the AI summary fails
  return null;
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
      // Replace the body content with edited data
      argsToExecute = {
        ...validation.args,
        body: editedData,
      };
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

    // Save the success message to the conversation history
    const actorId = getActorId(req);
    let responseMessage = "✅ Successfully completed the operation.";

    if (actorId) {
      try {
        const assistantService: AssistantModuleService =
          req.scope.resolve("assistant");

        // Generate a descriptive, human-readable success message using the AI
        const aiSummary = await generateSuccessMessage(
          payload,
          assistantService,
          actorId
        );

        // Only save to DB and update response if AI summary is successful
        if (aiSummary) {
          // Update the last message (which has the user's question) with the success answer
          await assistantService.updateLastMessageAnswer(actorId, aiSummary);
          responseMessage = aiSummary; // Use AI summary for the response
        }
      } catch (err) {
        console.error("Failed to save success message to conversation:", err);
        // Don't fail the request if we can't save to history
      }
    }

    return res.json({
      status: "approved",
      result,
      message: responseMessage,
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
