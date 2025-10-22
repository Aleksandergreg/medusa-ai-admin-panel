import type { Knex } from "knex";
import { subDays } from "date-fns";

const ANPS_TABLE = "agent_nps_response";

export interface CreateAnpsRecordParams {
  id: string;
  agentId: string;
  agentVersion: string | null;
  sessionId: string;
  userId: string | null;
  score: number;
  taskLabel: string | null;
  operationId: string | null;
  toolsUsedJson: string;
  durationMs: number | null;
  errorFlag: boolean;
  errorSummary: string | null;
  userPermission: boolean;
  clientMetadataJson: string | null;
}

/**
 * Repository layer for agent_nps_response table operations.
 * Handles all database queries related to Agent NPS records.
 */
export type AnpsRecentFilter = {
  taskLabel?: string | null;
};

export class AnpsRepository {
  constructor(private readonly db: Knex) {}

  /**
   * Insert a new Agent NPS record.
   */
  async create(params: CreateAnpsRecordParams): Promise<void> {
    const insertRecord: Record<string, unknown> = {
      id: params.id,
      agent_id: params.agentId,
      agent_version: params.agentVersion,
      session_id: params.sessionId,
      user_id: params.userId,
      score: params.score,
      task_label: params.taskLabel,
      operation_id: params.operationId,
      tools_used: this.db.raw("?::jsonb", [params.toolsUsedJson]),
      duration_ms: params.durationMs,
      error_flag: params.errorFlag,
      error_summary: params.errorSummary,
      user_permission: params.userPermission,
      client_metadata:
        params.clientMetadataJson !== null
          ? this.db.raw("?::jsonb", [params.clientMetadataJson])
          : this.db.raw("'{}'::jsonb"),
    };

    await this.db(ANPS_TABLE).insert(insertRecord);
  }

  /**
   * Get recent ANPS records, ordered by creation date descending.
   */
  async getRecent(
    limit: number,
    filters: AnpsRecentFilter = {}
  ): Promise<Array<Record<string, unknown>>> {
    const query = this.db<Record<string, unknown>>(ANPS_TABLE).orderBy(
      "created_at",
      "desc"
    );

    if (Object.prototype.hasOwnProperty.call(filters, "taskLabel")) {
      const taskLabel = filters.taskLabel;
      if (taskLabel === null) {
        query.whereNull("task_label");
      } else {
        query.where("task_label", taskLabel);
      }
    }

    return query.limit(limit);
  }

  /**
   * Get ANPS scores from the last N days for metrics calculation.
   */
  async getScoresForMetrics(
    days: number
  ): Promise<Array<Record<string, unknown>>> {
    const since = subDays(new Date(), days);
    return this.db<Record<string, unknown>>(ANPS_TABLE)
      .select(["task_label", "score"])
      .where("created_at", ">=", since)
      .whereNotNull("operation_id");
  }
}
