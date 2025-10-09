import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { validationManager } from "../../../../modules/assistant/lib/validation-manager";
import { getMcp } from "../../../../lib/mcp/manager";
import AssistantModuleService from "../../../../modules/assistant/service";
import { getActorId } from "../../../../modules/assistant/utils/auth-helpers";
import { isToolExecutionResult } from "../../../../modules/assistant/utils/type-guards";
import {
  getFirstTextContent,
  safeParseJson,
  normalizeErrorMessage,
} from "../../../../modules/assistant/utils/tool-result-helpers";
import { generateSuccessMessage } from "../../../../modules/assistant/lib/success-message-generator";

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
