/**
 * Helper functions for extracting authentication context from requests
 */

import type { AuthenticatedMedusaRequest } from "@medusajs/framework/http";

interface SessionWithAuthContext {
  auth_context?: {
    actor_id?: string;
  };
}

function hasAuthContext(session: unknown): session is SessionWithAuthContext {
  return (
    typeof session === "object" &&
    session !== null &&
    "auth_context" in session &&
    typeof (session as Record<string, unknown>).auth_context === "object" &&
    (session as Record<string, unknown>).auth_context !== null
  );
}

export function getActorId(req: AuthenticatedMedusaRequest): string | null {
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
