import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import AssistantModuleService from "../../../../modules/assistant/service";
import { validationManager } from "../../../../modules/assistant/lib/validation-manager";
import { getActorId } from "../../../../modules/assistant/utils/auth-helpers";

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

    if (typeof id !== "string" || !id.trim()) {
      return res
        .status(400)
        .json({ error: "Missing or invalid validation id" });
    }

    if (typeof approved !== "boolean") {
      return res
        .status(400)
        .json({ error: "Missing or invalid approved flag" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const assistantService = req.scope.resolve<AssistantModuleService>(
      "assistant"
    );

    const result = await assistantService.handleValidationResponse({
      actorId,
      id,
      approved,
      editedData,
    });

    return res.json({
      response: result.answer,
      history: result.history,
      updatedAt: result.updatedAt.toISOString(),
      validationRequest: result.validationRequest,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("\n--- Validation Route Error ---\n", e);

    const normalized = message?.toLowerCase() ?? "";
    const status =
      normalized.includes("not found") || normalized.includes("expired")
        ? 404
        : normalized.includes("unauthorized")
        ? 403
        : 400;

    return res.status(status).json({
      error: message || "Failed to resolve validation request",
    });
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
