import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { validationManager } from "../../../../modules/assistant/lib/validation-manager";
import { getMcp } from "../../../../lib/mcp/manager";

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
    const { id, approved, editedData } = (req.body as ValidationResponsePayload) ?? {};

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
