import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import AssistantModuleService from "../../../modules/assistant/service";

type AssistantPayload = {
  prompt: string;
  sessionId?: string | null;
};

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
    typeof (session as any).auth_context === "object" &&
    (session as any).auth_context !== null
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

  const legacyUserId = (req as any)?.user?.id;
  if (legacyUserId && typeof legacyUserId === "string" && legacyUserId.trim()) {
    return legacyUserId;
  }

  return null;
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  try {
    const { prompt, sessionId } = (req.body as AssistantPayload) ?? {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing or invalid prompt" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const result = await assistantService.prompt({
      prompt,
      sessionId,
      actorId,
    });

    return res.json({
      response: result.answer,
      history: result.history,
      sessionId: result.sessionId,
    });
  } catch (e: unknown) {
    console.error("\n--- Assistant Route Error ---\n", e);
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
    const queryParam = (req.query?.sessionId ?? req.query?.session_id) as
      | string
      | string[]
      | undefined;
    const sessionId = Array.isArray(queryParam) ? queryParam[0] : queryParam;

    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }

    const actorId = getActorId(req);
    if (!actorId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const session = await assistantService.getSession(sessionId, actorId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    return res.json({
      sessionId: session.sessionId,
      history: session.history,
      updatedAt: session.updatedAt?.toISOString() ?? null,
    });
  } catch (e: unknown) {
    console.error("\n--- Assistant Route Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
