import {
  AgentNpsRow,
  AgentNpsClientMetadata,
  normalizeClientMetadata,
  sanitizeToolUsage,
} from "../domain/anps/types";

/**
 * Mapper for ANPS data transformations.
 * Handles conversion between database rows and domain objects.
 */
export class AnpsMapper {
  /**
   * Convert unknown value to boolean.
   */
  static toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
    if (typeof value === "number") {
      return value === 1;
    }
    return false;
  }

  /**
   * Convert unknown value to optional string.
   */
  static toOptionalString(value: unknown): string | null {
    if (value == null) {
      return null;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const asString =
      typeof value === "string" ? value : value != null ? String(value) : "";
    const trimmed = asString.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * Map database row to AgentNpsRow domain object.
   */
  static mapAgentNpsRow(row: Record<string, unknown>): AgentNpsRow {
    const createdRaw = row.created_at;
    const createdAt =
      createdRaw instanceof Date
        ? createdRaw
        : new Date(this.toOptionalString(createdRaw) ?? 0);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("Invalid ANPS row: missing created_at");
    }

    const id = this.toOptionalString(row.id);
    const agentId = this.toOptionalString(row.agent_id);
    const sessionId = this.toOptionalString(row.session_id);
    const scoreValue = Number(row.score);

    if (!id || !agentId || !sessionId || !Number.isFinite(scoreValue)) {
      throw new Error("Invalid ANPS row returned from database");
    }

    const durationRaw = row.duration_ms;
    let durationMs: number | null = null;
    if (durationRaw != null) {
      const parsed = Number(durationRaw);
      durationMs = Number.isFinite(parsed) ? parsed : null;
    }

    return {
      id,
      created_at: createdAt,
      agent_id: agentId,
      agent_version: this.toOptionalString(row.agent_version),
      session_id: sessionId,
      user_id: this.toOptionalString(row.user_id),
      score: scoreValue,
      task_label: this.toOptionalString(row.task_label),
      operation_id: this.toOptionalString(row.operation_id),
      tools_used: sanitizeToolUsage(row.tools_used),
      duration_ms: durationMs,
      error_flag: this.toBoolean(row.error_flag),
      error_summary: this.toOptionalString(row.error_summary),
      user_permission: this.toBoolean(row.user_permission),
      client_metadata: normalizeClientMetadata(row.client_metadata),
    };
  }

  /**
   * Build client metadata object from config and runtime values.
   */
  static buildClientMetadata(
    plannerMode: string | undefined,
    modelName: string | undefined
  ): Record<string, unknown> {
    return {
      plannerMode,
      modelName,
    };
  }

  /**
   * Create aggregate metadata for turn-level feedback.
   */
  static buildTurnMetadata(params: {
    baseMetadata: Record<string, unknown>;
    operations: Array<{
      operationId: string;
      taskLabel: string | null;
      score: number;
      attempts: number;
      errors: number;
      durationMs: number | null;
      errorFlag: boolean;
      errorSummary: string | null;
      lastStatusCode: number | null;
      lastStatusMessage: string | null;
    }>;
    aggregateStats: {
      totalOperations: number;
      averageScore: number;
      bestScore: number;
      lowestScore: number;
      totalAttempts: number;
      totalErrors: number;
      durationMs: number | null;
      agentComputeMs: number | null;
    };
    feedback: string | null;
    llmFeedback: {
      summary: string;
      positives: string[];
      suggestions: string[];
    };
    prompt?: string | null;
  }): AgentNpsClientMetadata {
    const metadata: AgentNpsClientMetadata = {
      ...params.baseMetadata,
      isTurnFeedback: true,
      operations: params.operations,
      aggregate: params.aggregateStats,
      feedback: params.feedback,
      llmFeedback: params.llmFeedback,
      scoredAt: new Date().toISOString(),
    };

    const prompt = params.prompt?.toString().trim();
    if (prompt) {
      metadata.userPrompt = prompt;
    }

    return metadata;
  }

  /**
   * Create operation-level metadata with LLM feedback.
   */
  static buildOperationMetadata(params: {
    baseMetadata: Record<string, unknown>;
    attempts: number;
    errors: number;
    durationMs: number | null;
    feedback: string | null;
    llmFeedback: {
      summary: string;
      positives: string[];
      suggestions: string[];
    } | null;
  }): AgentNpsClientMetadata {
    return {
      ...params.baseMetadata,
      attempts: params.attempts,
      errors: params.errors,
      durationMs: params.durationMs,
      feedback: params.feedback,
      llmFeedback: params.llmFeedback,
      scoredAt: new Date().toISOString(),
    } as AgentNpsClientMetadata;
  }
}
