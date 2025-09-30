import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import AssistantModuleService from "../../../modules/assistant/service";
import { ConversationEntry } from "../../../modules/assistant/lib/types";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const { prompt, history = [] } = req.body as {
      prompt: string;
      history?: ConversationEntry[];
    };

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt" });
    }

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const response = await assistantService.prompt(prompt, history);

    return res.json({ response });
  } catch (e: unknown) {
    console.error("\n--- 💥 ASSISTANT ROUTE ERROR ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
