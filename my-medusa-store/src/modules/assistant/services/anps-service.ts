import type { Knex } from "knex";
import { AnpsRepository } from "../repositories/anps-repository";
import { AnpsMapper } from "../mappers/anps-mapper";
import {
  AgentNpsInsertInput,
  AgentNpsMetrics,
  AgentNpsRow,
  AgentNpsToolUsage,
  AgentNpsClientMetadata,
  computeNpsScore,
  sanitizeClientMetadata,
  sanitizeToolUsage,
} from "../domain/anps/types";
import { evaluateAgentNpsScore } from "../domain/anps/evaluator";
import {
  generateQualitativeFeedback,
  generateTurnSummaryFeedback,
} from "../domain/anps/feedback";
import { summarizeStatusMessages } from "../domain/anps/status-digest";
import type { QualitativeFeedback } from "../domain/anps/feedback";
import { AssistantModuleOptions } from "../config";
import { HistoryEntry } from "../lib/types";
import { generateId } from "../utils/idGenerator";
import { extractToolJsonPayload } from "../lib/utils";
import { getMcp } from "../../../lib/mcp/manager";

type AnpsSubmissionPayload = {
  score: number;
  sessionId: string;
  agentId: string;
  agentVersion?: string | null;
  userId?: string | null;
  taskLabel?: string | null;
  operationId?: string | null;
  toolsUsed: AgentNpsToolUsage[];
  durationMs?: number | null;
  errorFlag: boolean;
  errorSummary?: string | null;
  clientMetadata?: AgentNpsClientMetadata | null;
};

/**
 * Service layer for Agent NPS (Net Promoter Score) management.
 * Orchestrates ANPS scoring, evaluation, feedback generation, and persistence.
 */
export class AnpsService {
  private readonly repository: AnpsRepository;
  private readonly config: AssistantModuleOptions;
  private readonly scoredOperations = new Map<string, Set<string>>();
  private readonly pendingOperations = new Map<string, Set<string>>();

  constructor(db: Knex, config: AssistantModuleOptions) {
    this.repository = new AnpsRepository(db);
    this.config = config;
  }

  /**
   * Record a new Agent NPS entry.
   */
  async recordAgentNps(input: AgentNpsInsertInput): Promise<{ id: string }> {
    const agentId = input.agentId?.trim();
    const sessionId = input.sessionId?.trim();
    const score = Number(input.score);

    if (!agentId) {
      console.warn(
        JSON.stringify({
          event: "agent_nps.validation_failed",
          reason: "missing_agent_id",
        })
      );
      throw new Error("Missing agent identifier");
    }

    if (!sessionId) {
      console.warn(
        JSON.stringify({
          event: "agent_nps.validation_failed",
          reason: "missing_session_id",
        })
      );
      throw new Error("Missing session identifier");
    }

    if (
      !Number.isInteger(score) ||
      score < 0 ||
      score > 10 ||
      Number.isNaN(score)
    ) {
      console.warn(
        JSON.stringify({
          event: "agent_nps.validation_failed",
          reason: "invalid_score",
          score,
        })
      );
      throw new Error("Score must be an integer between 0 and 10");
    }

    if (!input.userPermission) {
      console.warn(
        JSON.stringify({
          event: "agent_nps.validation_failed",
          reason: "user_permission_false",
        })
      );
      throw new Error("User permission is required before recording ANPS");
    }

    const id = generateId("anps");
    const toolsUsed = sanitizeToolUsage(input.toolsUsed ?? []);
    const duration =
      typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
        ? Math.max(0, Math.trunc(input.durationMs))
        : null;
    const clientMetadata = sanitizeClientMetadata(input.clientMetadata ?? null);

    const jsonTools = JSON.stringify(toolsUsed);
    const jsonMetadata = clientMetadata ? JSON.stringify(clientMetadata) : null;

    const logRecord = {
      id,
      agent_id: agentId,
      agent_version: input.agentVersion?.trim() || null,
      session_id: sessionId,
      user_id: input.userId?.trim() || null,
      score,
      task_label: input.taskLabel?.trim() || null,
      operation_id: input.operationId?.trim() || null,
      tools_used: toolsUsed,
      duration_ms: duration,
      error_flag: Boolean(input.errorFlag),
      error_summary: input.errorSummary?.trim() || null,
      user_permission: true,
      client_metadata: clientMetadata,
    };

    try {
      await this.repository.create({
        id,
        agentId,
        agentVersion: input.agentVersion?.trim() || null,
        sessionId,
        userId: input.userId?.trim() || null,
        score,
        taskLabel: input.taskLabel?.trim() || null,
        operationId: input.operationId?.trim() || null,
        toolsUsedJson: jsonTools,
        durationMs: duration,
        errorFlag: Boolean(input.errorFlag),
        errorSummary: input.errorSummary?.trim() || null,
        userPermission: true,
        clientMetadataJson: jsonMetadata,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "agent_nps.insert_error",
          message: error instanceof Error ? error.message : String(error),
          record: logRecord,
        })
      );
      throw error;
    }

    console.info(
      JSON.stringify({
        event: "agent_nps.inserted",
        id,
        score,
        task_label: logRecord.task_label,
        operation_id: logRecord.operation_id,
        tools_used: toolsUsed.length,
        error_flag: logRecord.error_flag,
      })
    );

    return { id };
  }

  /**
   * Get Agent NPS metrics for the last 30 days.
   */
  async getAgentNpsMetrics(): Promise<AgentNpsMetrics> {
    const rows = await this.repository.getScoresForMetrics(30);

    const globalScores: number[] = [];
    const byTask = new Map<string | null, number[]>();

    for (const row of rows) {
      const numericScore = Number(row.score);
      if (!Number.isFinite(numericScore)) {
        continue;
      }
      globalScores.push(numericScore);

      const rawLabel =
        typeof row.task_label === "string" ? row.task_label.trim() : "";
      const label = rawLabel.length ? rawLabel : null;
      const bucket = byTask.get(label) ?? [];
      bucket.push(numericScore);
      byTask.set(label, bucket);
    }

    const taskBreakdown = Array.from(byTask.entries())
      .map(([label, scores]) => ({
        taskLabel: label,
        responses: scores.length,
        nps: computeNpsScore(scores),
      }))
      .sort((a, b) => b.responses - a.responses);

    return {
      last30Days: {
        responses: globalScores.length,
        nps: computeNpsScore(globalScores),
      },
      byTask: taskBreakdown,
    };
  }

  /**
   * List recent Agent NPS records.
   */
  async listRecentAgentNps(limit = 20): Promise<AgentNpsRow[]> {
    const rows = await this.repository.getRecent(limit);

    return rows.map((row) => {
      const parsed = AnpsMapper.mapAgentNpsRow(row);
      console.debug(
        JSON.stringify({
          event: "agent_nps.row_debug",
          id: parsed.id,
          score: parsed.score,
          created_at: parsed.created_at.toISOString(),
          task_label: parsed.task_label,
        })
      );
      return parsed;
    });
  }

  /**
   * Extract executed operations from history entries.
   */
  extractExecutedOperations(
    entries: HistoryEntry[]
  ): { operationId: string; taskLabel: string | null }[] {
    const operations: { operationId: string; taskLabel: string | null }[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (!entry || entry.tool_name !== "openapi.execute") {
        continue;
      }
      const args =
        entry.tool_args && typeof entry.tool_args === "object"
          ? (entry.tool_args as Record<string, unknown>)
          : null;
      if (!args) {
        continue;
      }
      const operationId =
        AnpsMapper.toOptionalString(args?.operationId) ??
        AnpsMapper.toOptionalString(
          (args as Record<string, unknown>).operation_id
        );
      if (!operationId) {
        continue;
      }
      const trimmedOperationId = operationId.trim();
      const key = trimmedOperationId.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      operations.push({
        operationId,
        taskLabel: trimmedOperationId.length ? trimmedOperationId : null,
      });
    }
    return operations;
  }

  /**
   * Collect unique tool usage from history entries.
   */
  collectToolUsage(entries: HistoryEntry[]): AgentNpsToolUsage[] {
    const seen = new Set<string>();
    const usage: AgentNpsToolUsage[] = [];
    for (const entry of entries) {
      const name = AnpsMapper.toOptionalString(entry.tool_name);
      if (!name) {
        continue;
      }
      if (name.startsWith("assistant.") || name === "conversation") {
        continue;
      }
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      usage.push({ name });
    }
    return usage;
  }

  /**
   * Check if an operation has already been scored for a session.
   */
  hasOperationBeenScored(sessionId: string, operationId: string): boolean {
    const existing = this.scoredOperations.get(sessionId);
    return existing ? existing.has(operationId) : false;
  }

  /**
   * Mark an operation as scored to prevent duplicate scoring.
   */
  markOperationScored(sessionId: string, operationId: string): void {
    const existing = this.scoredOperations.get(sessionId);
    if (existing) {
      existing.add(operationId);
    } else {
      this.scoredOperations.set(sessionId, new Set([operationId]));
    }
  }

  /**
   * Check if an operation scoring is currently in progress.
   */
  isOperationPending(sessionId: string, operationId: string): boolean {
    const pending = this.pendingOperations.get(sessionId);
    return pending ? pending.has(operationId) : false;
  }

  /**
   * Mark an operation as pending (scoring in progress).
   */
  addPendingOperation(sessionId: string, operationId: string): void {
    const pending = this.pendingOperations.get(sessionId);
    if (pending) {
      pending.add(operationId);
    } else {
      this.pendingOperations.set(sessionId, new Set([operationId]));
    }
  }

  /**
   * Clear pending status for an operation.
   */
  clearPendingOperation(sessionId: string, operationId: string): void {
    const pending = this.pendingOperations.get(sessionId);
    if (!pending) {
      return;
    }
    pending.delete(operationId);
    if (pending.size === 0) {
      this.pendingOperations.delete(sessionId);
    }
  }

  /**
   * Schedule ANPS submission for executed operations.
   * This is triggered after an agent response completes.
   */
  scheduleAnpsSubmission(params: {
    actorId: string;
    sessionId: string;
    history: HistoryEntry[];
    durationMs: number;
    agentComputeMs?: number;
    answer?: string | null;
    prompt?: string;
  }): void {
    const operations = this.extractExecutedOperations(params.history).filter(
      (operation) =>
        !this.hasOperationBeenScored(params.sessionId, operation.operationId) &&
        !this.isOperationPending(params.sessionId, operation.operationId)
    );

    if (!operations.length) {
      return;
    }

    for (const operation of operations) {
      this.addPendingOperation(params.sessionId, operation.operationId);
    }

    this.autoSubmitAnpsIfEligible({ ...params, operations }).catch((error) => {
      console.error(
        JSON.stringify({
          event: "agent_nps.async_submit_failed",
          message: error instanceof Error ? error.message : String(error),
          session_id: params.sessionId,
        })
      );
    });
  }

  /**
   * Automatically evaluate and submit ANPS scores for eligible operations.
   * Includes LLM-generated qualitative feedback.
   */
  async autoSubmitAnpsIfEligible(params: {
    actorId: string;
    sessionId: string;
    history: HistoryEntry[];
    durationMs: number;
    agentComputeMs?: number;
    answer?: string | null;
    prompt?: string;
    operations?: { operationId: string; taskLabel: string | null }[];
  }): Promise<void> {
    const operations =
      params.operations && params.operations.length
        ? params.operations
        : this.extractExecutedOperations(params.history);
    if (!operations.length) {
      return;
    }

    const { agentId, agentVersion } = this.getAgentIdentifiers();
    const toolUsage = sanitizeToolUsage(this.collectToolUsage(params.history));
    const evaluatedOperations: {
      operationId: string;
      taskLabel: string | null;
      evaluation: ReturnType<typeof evaluateAgentNpsScore>;
    }[] = [];
    let successfulSubmissions = 0;

    for (const operation of operations) {
      try {
        if (
          this.hasOperationBeenScored(params.sessionId, operation.operationId)
        ) {
          continue;
        }

        const evaluation = evaluateAgentNpsScore({
          operationId: operation.operationId,
          taskLabel: operation.taskLabel,
          history: params.history,
          durationMs: params.durationMs,
          agentComputeMs: params.agentComputeMs,
        });

        if (!evaluation) {
          continue;
        }

        let qualitativeFeedback: QualitativeFeedback | null = null;
        try {
          qualitativeFeedback = await generateQualitativeFeedback({
            operationId: operation.operationId,
            taskLabel: operation.taskLabel ?? null,
            evaluation,
            history: params.history,
            answer: params.answer ?? null,
            config: this.config,
            relatedOperations: operations,
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "agent_feedback.generate_failed",
              message: error instanceof Error ? error.message : String(error),
              operation_id: operation.operationId,
            })
          );
        }

        const baseMetadata = AnpsMapper.buildClientMetadata(
          this.config.plannerMode,
          this.config.modelName
        );

        const metadata = AnpsMapper.buildOperationMetadata({
          baseMetadata,
          attempts: evaluation.attempts,
          errors: evaluation.errors,
          durationMs: evaluation.durationMs ?? null,
          feedback: evaluation.feedbackNote ?? null,
          llmFeedback: qualitativeFeedback
            ? {
                summary: qualitativeFeedback.summary,
                positives: qualitativeFeedback.positives,
                suggestions: qualitativeFeedback.suggestions,
              }
            : null,
        });

        const sanitizedMetadata = sanitizeClientMetadata(metadata);

        const submission: AnpsSubmissionPayload = {
          score: evaluation.score,
          sessionId: params.sessionId,
          agentId,
          agentVersion,
          userId: params.actorId,
          taskLabel: operation.taskLabel,
          operationId: operation.operationId,
          toolsUsed: toolUsage,
          durationMs: evaluation.durationMs,
          errorFlag: evaluation.errorFlag,
          errorSummary: evaluation.errorSummary ?? undefined,
          clientMetadata: sanitizedMetadata,
        };

        const result = await this.submitAgentNpsRecord(submission);
        if (result.ok) {
          this.markOperationScored(params.sessionId, operation.operationId);
          evaluatedOperations.push({
            operationId: operation.operationId,
            taskLabel: operation.taskLabel ?? null,
            evaluation,
          });
          successfulSubmissions += 1;
        }
      } finally {
        this.clearPendingOperation(params.sessionId, operation.operationId);
      }
    }

    // Generate turn-level summary feedback if multiple operations were scored
    if (successfulSubmissions > 0 && evaluatedOperations.length) {
      await this.submitTurnSummaryFeedback({
        actorId: params.actorId,
        sessionId: params.sessionId,
        evaluatedOperations,
        history: params.history,
        answer: params.answer ?? null,
        durationMs: params.durationMs,
        agentComputeMs: params.agentComputeMs,
        agentId,
        agentVersion,
        toolUsage,
        prompt: params.prompt ?? null,
      });
    }
  }

  /**
   * Submit turn-level summary feedback aggregating multiple operations.
   */
  private async submitTurnSummaryFeedback(params: {
    actorId: string;
    sessionId: string;
    evaluatedOperations: Array<{
      operationId: string;
      taskLabel: string | null;
      evaluation: ReturnType<typeof evaluateAgentNpsScore>;
    }>;
    history: HistoryEntry[];
    answer: string | null;
    durationMs: number;
    agentComputeMs?: number;
    agentId: string;
    agentVersion: string | null;
    toolUsage: AgentNpsToolUsage[];
    prompt: string | null;
  }): Promise<void> {
    let turnFeedback: QualitativeFeedback | null = null;
    try {
      turnFeedback = await generateTurnSummaryFeedback({
        operations: params.evaluatedOperations,
        history: params.history,
        answer: params.answer,
        config: this.config,
        durationMs: params.durationMs,
        agentComputeMs: params.agentComputeMs,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "agent_feedback.turn_generate_failed",
          message: error instanceof Error ? error.message : String(error),
          session_id: params.sessionId,
        })
      );
    }

    if (!turnFeedback) {
      return;
    }

    const aggregateScore = Math.round(
      params.evaluatedOperations.reduce(
        (sum, item) => sum + item.evaluation.score,
        0
      ) / params.evaluatedOperations.length
    );
    const scores = params.evaluatedOperations.map(
      (item) => item.evaluation.score
    );
    const bestScore = Math.max(...scores);
    const lowestScore = Math.min(...scores);
    const totalAttempts = params.evaluatedOperations.reduce(
      (sum, item) => sum + item.evaluation.attempts,
      0
    );
    const totalErrors = params.evaluatedOperations.reduce(
      (sum, item) => sum + item.evaluation.errors,
      0
    );
    const aggregateErrorFlag = params.evaluatedOperations.some(
      (item) => item.evaluation.errorFlag
    );
    const aggregateErrorSummary =
      params.evaluatedOperations
        .map((item) => item.evaluation.errorSummary)
        .filter((value): value is string => typeof value === "string")
        .slice(-1)[0] ?? null;

    const operationsMetadata = params.evaluatedOperations.map((item) => {
      const statuses = summarizeStatusMessages(
        params.history,
        item.operationId
      );
      const lastStatus =
        statuses.length > 0 ? statuses[statuses.length - 1] : null;
      return {
        operationId: item.operationId,
        taskLabel: item.taskLabel ?? null,
        score: item.evaluation.score,
        attempts: item.evaluation.attempts,
        errors: item.evaluation.errors,
        durationMs: item.evaluation.durationMs ?? null,
        errorFlag: item.evaluation.errorFlag,
        errorSummary: item.evaluation.errorSummary ?? null,
        lastStatusCode: lastStatus?.statusCode ?? null,
        lastStatusMessage: lastStatus?.message ?? null,
      };
    });

    const baseMetadata = AnpsMapper.buildClientMetadata(
      this.config.plannerMode,
      this.config.modelName
    );

    const metadata = AnpsMapper.buildTurnMetadata({
      baseMetadata,
      operations: operationsMetadata,
      aggregateStats: {
        totalOperations: params.evaluatedOperations.length,
        averageScore: aggregateScore,
        bestScore,
        lowestScore,
        totalAttempts,
        totalErrors,
        durationMs: params.durationMs ?? null,
        agentComputeMs: params.agentComputeMs ?? null,
      },
      feedback:
        params.evaluatedOperations
          .map((item) => item.evaluation.feedbackNote)
          .filter((note): note is string => typeof note === "string")
          .join(" | ") || null,
      llmFeedback: {
        summary: turnFeedback.summary,
        positives: turnFeedback.positives,
        suggestions: turnFeedback.suggestions,
      },
      prompt: params.prompt ?? undefined,
    });

    const sanitizedMetadata = sanitizeClientMetadata(metadata);

    await this.submitAgentNpsRecord({
      score: aggregateScore,
      sessionId: params.sessionId,
      agentId: params.agentId,
      agentVersion: params.agentVersion,
      userId: params.actorId,
      taskLabel: "turn-summary",
      operationId: null,
      toolsUsed: params.toolUsage,
      durationMs: params.durationMs,
      errorFlag: aggregateErrorFlag,
      errorSummary: aggregateErrorSummary ?? undefined,
      clientMetadata: sanitizedMetadata,
    });
  }

  /**
   * Submit an ANPS record via MCP tool.
   */
  private async submitAgentNpsRecord(
    payload: AnpsSubmissionPayload
  ): Promise<{ ok: boolean; id?: string; message?: string }> {
    try {
      const mcp = await getMcp();
      const result = await mcp.callTool("agent_nps.submit", {
        score: payload.score,
        sessionId: payload.sessionId,
        agentId: payload.agentId,
        agentVersion: payload.agentVersion ?? undefined,
        userId: payload.userId ?? undefined,
        taskLabel: payload.taskLabel ?? undefined,
        operationId: payload.operationId ?? undefined,
        toolsUsed: payload.toolsUsed,
        durationMs: payload.durationMs ?? undefined,
        errorFlag: payload.errorFlag,
        errorSummary: payload.errorSummary ?? undefined,
        userPermission: true,
        clientMetadata: payload.clientMetadata ?? undefined,
      });
      const parsed = extractToolJsonPayload(result);
      if (
        parsed &&
        typeof parsed === "object" &&
        "ok" in parsed &&
        parsed.ok === true &&
        typeof parsed.id === "string"
      ) {
        console.info(
          JSON.stringify({
            event: "agent_nps.submit_success",
            id: parsed.id,
            session_id: payload.sessionId,
            task_label: payload.taskLabel ?? null,
          })
        );
        return { ok: true, id: parsed.id };
      }
      const message =
        parsed && typeof parsed === "object" && "message" in parsed
          ? AnpsMapper.toOptionalString(
              (parsed as Record<string, unknown>).message
            ) ?? "Submission rejected"
          : "Submission rejected";
      console.warn(
        JSON.stringify({
          event: "agent_nps.submit_failed",
          message,
          session_id: payload.sessionId,
        })
      );
      return { ok: false, message };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit ANPS";
      console.error(
        JSON.stringify({
          event: "agent_nps.submit_error",
          message,
          session_id: payload.sessionId,
        })
      );
      return { ok: false, message };
    }
  }

  /**
   * Get agent identifiers from environment or config.
   */
  private getAgentIdentifiers(): {
    agentId: string;
    agentVersion: string | null;
  } {
    const agentId = process.env.ASSISTANT_AGENT_ID ?? "medusa-assistant";
    const agentVersion =
      process.env.ASSISTANT_AGENT_VERSION ??
      process.env.ASSISTANT_VERSION ??
      process.env.npm_package_version ??
      this.config.modelName ??
      null;
    return { agentId, agentVersion };
  }
}
