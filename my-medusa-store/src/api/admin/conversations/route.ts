import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import type AssistantModuleService from "../../../modules/assistant/service";

function getActorId(req: AuthenticatedMedusaRequest): string | null {
  const actor = req.auth_context?.actor_id;
  if (typeof actor === "string" && actor) {
    return actor;
  }
  return null;
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const conversations = await assistantService.listConversations(actorId);

    return res.json({ conversations });
  } catch (e: unknown) {
    console.error("\n--- List Conversations Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { title } = (req.body as { title?: string }) ?? {};

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const conversation = await assistantService.createConversation(
      actorId,
      title
    );

    return res.json({ conversation });
  } catch (e: unknown) {
    console.error("\n--- Create Conversation Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
