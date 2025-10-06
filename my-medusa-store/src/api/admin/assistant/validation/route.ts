import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { validationManager } from "../../../../modules/assistant/lib/validation-manager";
import { getMcp } from "../../../../lib/mcp/manager";

type ValidationResponsePayload = {
  id: string;
  approved: boolean;
};

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const { id, approved } = (req.body as ValidationResponsePayload) ?? {};

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

    // Execute the actual operation
    const mcp = await getMcp();
    const result = await mcp.callTool("openapi.execute", validation.args);

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
