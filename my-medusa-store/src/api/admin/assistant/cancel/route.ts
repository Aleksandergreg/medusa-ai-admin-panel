import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import AssistantModuleService from "../../../../modules/assistant/service";

type CancelPayload = {
  sessionId?: string;
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
    typeof (session as SessionWithAuthContext).auth_context === "object" &&
    (session as SessionWithAuthContext).auth_context !== null
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
    | Record<string, unknown>
    | undefined;
  const userId = legacyUserId?.id;
  if (userId && typeof userId === "string" && userId.trim()) {
    return userId;
  }

  return null;
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

    const { sessionId } = (req.body as CancelPayload) ?? {};

    const assistantService =
      req.scope.resolve<AssistantModuleService>("assistant");

    const cancelled = assistantService.cancelRequest(actorId, sessionId);

    return res.json({
      cancelled,
      message: cancelled
        ? "Request cancelled successfully"
        : "No active request found",
    });
  } catch (e: unknown) {
    console.error("\n--- Assistant Cancel Error ---\n", e);
    return res
      .status(500)
      .json({ error: e instanceof Error ? e.message : String(e) });
  }
}
