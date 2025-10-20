import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import type AssistantModuleService from "../../../../modules/assistant/service";

function getActorId(req: AuthenticatedMedusaRequest): string | null {
  const actor = req.auth_context?.actor_id;
  if (typeof actor === "string" && actor) {
    return actor;
  }
  return null;
}

export async function GET(
  req: AuthenticatedMedusaRequest<{ id: string }>,
  res: MedusaResponse
) {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const conversation = await assistantService.getConversationBySession(
      actorId,
      id
    );

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json({
      history: conversation.history,
      updatedAt: conversation.updatedAt?.toISOString() ?? null,
    });
  } catch (e: unknown) {
    console.error("\n--- Get Conversation Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function DELETE(
  req: AuthenticatedMedusaRequest<{ id: string }>,
  res: MedusaResponse
) {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const deleted = await assistantService.deleteConversation(actorId, id);

    if (!deleted) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json({ success: true });
  } catch (e: unknown) {
    console.error("\n--- Delete Conversation Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}

export async function PATCH(
  req: AuthenticatedMedusaRequest<{ id: string }>,
  res: MedusaResponse
) {
  try {
    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const { title } = (req.body as { title?: string }) ?? {};

    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const updated = await assistantService.updateConversationTitle(
      actorId,
      id,
      title
    );

    if (!updated) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json({ success: true });
  } catch (e: unknown) {
    console.error("\n--- Update Conversation Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
