export const ANPS_TABLE = "agent_nps_response";

export type AgentNpsToolUsage = Record<string, unknown>;
export type AgentNpsClientMetadata = Record<string, unknown>;

export interface AgentNpsInsertInput {
  agentId: string;
  agentVersion?: string | null;
  sessionId: string;
  userId?: string | null;
  score: number;
  taskLabel?: string | null;
  operationId?: string | null;
  toolsUsed?: AgentNpsToolUsage[];
  durationMs?: number | null;
  errorFlag?: boolean;
  errorSummary?: string | null;
  userPermission: boolean;
  clientMetadata?: AgentNpsClientMetadata | null;
}

export interface AgentNpsEvaluation {
  score: number;
  errorFlag: boolean;
  errorSummary: string | null;
  attempts: number;
  errors: number;
  durationMs: number | null;
  feedbackNote?: string;
}

export interface AgentNpsRow {
  id: string;
  created_at: Date;
  agent_id: string;
  agent_version: string | null;
  session_id: string;
  user_id: string | null;
  score: number;
  task_label: string | null;
  operation_id: string | null;
  tools_used: AgentNpsToolUsage[];
  duration_ms: number | null;
  error_flag: boolean;
  error_summary: string | null;
  user_permission: boolean;
  client_metadata: AgentNpsClientMetadata | null;
}

export interface AgentNpsSummary {
  responses: number;
  nps: number | null;
}

export interface AgentNpsTaskBreakdown extends AgentNpsSummary {
  taskLabel: string | null;
}

export interface AgentNpsMetrics {
  last30Days: AgentNpsSummary;
  byTask: AgentNpsTaskBreakdown[];
}

export function computeNpsScore(scores: number[]): number | null {
  if (scores.length === 0) {
    return null;
  }

  let promoters = 0;
  let detractors = 0;
  for (const value of scores) {
    if (value >= 9) {
      promoters += 1;
    } else if (value <= 6) {
      detractors += 1;
    }
  }

  const total = scores.length;
  const raw = ((promoters - detractors) / total) * 100;
  return Math.round(raw * 10) / 10;
}

export function sanitizeToolUsage(tools: unknown): AgentNpsToolUsage[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  const sanitized: AgentNpsToolUsage[] = [];
  for (const entry of tools) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      sanitized.push(entry as Record<string, unknown>);
    } else if (typeof entry === "string" && entry.trim()) {
      sanitized.push({ name: entry.trim() });
    }
  }
  return sanitized;
}

export function normalizeClientMetadata(
  metadata: unknown
): AgentNpsClientMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return metadata as Record<string, unknown>;
}

export function sanitizeClientMetadata(
  metadata: AgentNpsClientMetadata | null
): AgentNpsClientMetadata | null {
  if (!metadata) {
    return null;
  }
  try {
    const sanitized = JSON.parse(
      JSON.stringify(metadata, (_key, value) => {
        if (value === undefined) {
          return null;
        }
        if (value instanceof Date) {
          return value.toISOString();
        }
        if (typeof value === "number" && !Number.isFinite(value)) {
          return null;
        }
        return value;
      })
    ) as AgentNpsClientMetadata;
    return sanitized;
  } catch {
    return null;
  }
}
