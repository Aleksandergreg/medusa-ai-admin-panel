import {
  ContainerRegistrationKeys,
  MedusaService,
} from "@medusajs/framework/utils";
import type { Knex } from "knex";
import { subDays } from "date-fns";
import { askAgent } from "./agent/ask";
import { AssistantModuleOptions, DEFAULT_ASSISTANT_OPTIONS } from "./config";
import { validationManager } from "./lib/validation-manager";
import type {
  PendingValidationContext,
  ValidationContinuationResult,
} from "./lib/validation-types";
import {
  ConversationEntry,
  ConversationRow,
  ConversationSummary,
  HistoryEntry,
  MessageRow,
  PromptInput,
  PromptResult,
  ValidationRequest,
} from "./lib/types";
import { generateId } from "./utils/idGenerator";
import {
  AgentNpsInsertInput,
  AgentNpsMetrics,
  AgentNpsRow,
  AgentNpsToolUsage,
  AgentNpsClientMetadata,
  ANPS_TABLE,
  computeNpsScore,
  normalizeClientMetadata,
  sanitizeClientMetadata,
  sanitizeToolUsage,
} from "./lib/anps";
import { evaluateAgentNpsScore } from "./lib/anps-evaluator";
import { generateQualitativeFeedback } from "./lib/anps-feedback";
import { extractToolJsonPayload } from "./lib/utils";
import { getMcp } from "../../lib/mcp/manager";

const CONVERSATION_TABLE = "conversation_session";
const MESSAGE_TABLE = "conversation_message";

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

const DEFAULT_FAILURE_MESSAGE =
  "Sorry, I could not find an answer to your question.";
const CANCEL_MESSAGE =
  `## ❌ Action Cancelled\n\n` +
  `No changes were made to your store. The operation has been cancelled as requested.\n\n` +
  `Feel free to ask me to do something else!`;

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;
  private readonly scoredOperations = new Map<string, Set<string>>();

  constructor(
    container: Record<string, unknown>,
    options: AssistantModuleOptions = DEFAULT_ASSISTANT_OPTIONS
  ) {
    super(container, options);
    this.config = { ...DEFAULT_ASSISTANT_OPTIONS, ...options };
  }

  private get db(): Knex {
    return (this as any).__container__[
      ContainerRegistrationKeys.PG_CONNECTION
    ] as Knex;
  }

  private toBoolean(value: unknown): boolean {
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

  private toOptionalString(value: unknown): string | null {
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

  private mapAgentNpsRow(row: Record<string, unknown>): AgentNpsRow {
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

  private detectMajorOperation(
    entries: HistoryEntry[]
  ): { operationId: string; taskLabel: string | null } | null {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      if (!entry) continue;
      if (entry.tool_name !== "openapi.execute") {
        continue;
      }
      const args = entry.tool_args as Record<string, unknown>;
      if (!args) {
        continue;
      }
      const operationId =
        this.toOptionalString(args?.operationId) ??
        this.toOptionalString((args as Record<string, unknown>).operation_id);
      if (!operationId) {
        continue;
      }
      return { operationId, taskLabel: this.toTaskLabel(operationId) };
    }
    return null;
  }

  private toTaskLabel(operationId: string): string | null {
    const normalized = operationId.toLowerCase().replace(/[_-]/g, "");
    if (normalized.includes("promotion")) {
      return "create-promotion";
    }
    if (normalized.includes("pricelist")) {
      return "apply-price-list";
    }
    if (normalized.includes("order")) {
      return "fulfill-order";
    }
    const hyphenated = operationId
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/[^a-z0-9-]/gi, "")
      .toLowerCase()
      .replace(/^-|-$/g, "");
    return hyphenated.length > 0 ? hyphenated : null;
  }

  private collectToolUsage(entries: HistoryEntry[]): AgentNpsToolUsage[] {
    const seen = new Set<string>();
    const usage: AgentNpsToolUsage[] = [];
    for (const entry of entries) {
      const name = this.toOptionalString(entry.tool_name);
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

  private hasOperationBeenScored(sessionId: string, operationId: string): boolean {
    const existing = this.scoredOperations.get(sessionId);
    return existing ? existing.has(operationId) : false;
  }

  private markOperationScored(sessionId: string, operationId: string): void {
    const existing = this.scoredOperations.get(sessionId);
    if (existing) {
      existing.add(operationId);
    } else {
      this.scoredOperations.set(sessionId, new Set([operationId]));
    }
  }

  private async autoSubmitAnpsIfEligible(params: {
    actorId: string;
    sessionId: string;
    history: HistoryEntry[];
    durationMs: number;
    agentComputeMs?: number;
    answer?: string | null;
  }): Promise<void> {
    const majorOperation = this.detectMajorOperation(params.history);
    if (!majorOperation) {
      return;
    }

    if (this.hasOperationBeenScored(params.sessionId, majorOperation.operationId)) {
      return;
    }

    const evaluation = evaluateAgentNpsScore({
      operationId: majorOperation.operationId,
      taskLabel: majorOperation.taskLabel,
      history: params.history,
      durationMs: params.durationMs,
      agentComputeMs: params.agentComputeMs,
    });

    if (!evaluation) {
      return;
    }

    const { agentId, agentVersion } = this.getAgentIdentifiers();
    let qualitativeFeedback = null;
    try {
      qualitativeFeedback = await generateQualitativeFeedback({
        operationId: majorOperation.operationId,
        taskLabel: majorOperation.taskLabel ?? null,
        evaluation,
        history: params.history,
        answer: params.answer ?? null,
        config: this.config,
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "agent_feedback.generate_failed",
          message: error instanceof Error ? error.message : String(error),
          operation_id: majorOperation.operationId,
        })
      );
    }
    const toolUsage = sanitizeToolUsage(
      this.collectToolUsage(params.history)
    );
    const metadata = {
      ...this.buildClientMetadata(),
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
      scoredAt: new Date().toISOString(),
    } as AgentNpsClientMetadata;

    const sanitizedMetadata = sanitizeClientMetadata(metadata);

    const submission: AnpsSubmissionPayload = {
      score: evaluation.score,
      sessionId: params.sessionId,
      agentId,
      agentVersion,
      userId: params.actorId,
      taskLabel: majorOperation.taskLabel,
      operationId: majorOperation.operationId,
      toolsUsed: toolUsage,
      durationMs: evaluation.durationMs,
      errorFlag: evaluation.errorFlag,
      errorSummary: evaluation.errorSummary ?? undefined,
      clientMetadata: sanitizedMetadata,
    };

    const result = await this.submitAgentNpsRecord(submission);
    if (result.ok) {
      this.markOperationScored(params.sessionId, majorOperation.operationId);
    }
  }

  private getAgentIdentifiers(): {
    agentId: string;
    agentVersion: string | null;
  } {
    const agentId =
      process.env.ASSISTANT_AGENT_ID ?? "medusa-assistant";
    const agentVersion =
      process.env.ASSISTANT_AGENT_VERSION ??
      process.env.ASSISTANT_VERSION ??
      process.env.npm_package_version ??
      this.config.modelName ??
      null;
    return { agentId, agentVersion };
  }

  private buildClientMetadata(): Record<string, unknown> {
    return {
      plannerMode: this.config.plannerMode,
      modelName: this.config.modelName,
    };
  }

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
          ? this.toOptionalString((parsed as Record<string, unknown>).message) ??
            "Submission rejected"
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

  public getConfig(): AssistantModuleOptions {
    return this.config;
  }

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
    const clientMetadata = sanitizeClientMetadata(
      normalizeClientMetadata(input.clientMetadata ?? null)
    );

    const knex = this.db;

    const jsonTools = JSON.stringify(toolsUsed);
    const jsonMetadata = clientMetadata
      ? JSON.stringify(clientMetadata)
      : null;

    const insertRecord: Record<string, unknown> = {
      id,
      agent_id: agentId,
      agent_version: input.agentVersion?.trim() || null,
      session_id: sessionId,
      user_id: input.userId?.trim() || null,
      score,
      task_label: input.taskLabel?.trim() || null,
      operation_id: input.operationId?.trim() || null,
      tools_used: knex.raw("?::jsonb", [jsonTools]),
      duration_ms: duration,
      error_flag: Boolean(input.errorFlag),
      error_summary: input.errorSummary?.trim() || null,
      user_permission: true,
      client_metadata:
        jsonMetadata !== null
          ? knex.raw("?::jsonb", [jsonMetadata])
          : knex.raw("'{}'::jsonb"),
    };

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
      await knex(ANPS_TABLE).insert(insertRecord);
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

  async getAgentNpsMetrics(): Promise<AgentNpsMetrics> {
    const since = subDays(new Date(), 30);
    const rows = await this.db<Record<string, unknown>>(ANPS_TABLE)
      .select(["task_label", "score"])
      .where("created_at", ">=", since);

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

  async listRecentAgentNps(limit = 20): Promise<AgentNpsRow[]> {
    const rows = await this.db<Record<string, unknown>>(ANPS_TABLE)
      .orderBy("created_at", "desc")
      .limit(limit);

    return rows.map((row) => {
      const parsed = this.mapAgentNpsRow(row);
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

  async prompt(input: PromptInput): Promise<PromptResult> {
    const trimmedPrompt = input.prompt?.trim();
    if (!trimmedPrompt) {
      throw new Error("Missing prompt");
    }

    const actorId = input.actorId?.trim();
    if (!actorId) {
      throw new Error("Missing actor identifier");
    }

    const existing = input.sessionId
      ? await this.getConversationBySession(actorId, input.sessionId)
      : await this.getConversation(actorId);
    const existingHistory = existing?.history ?? [];
    const requestStartedAt = Date.now();

    const pendingForActor =
      validationManager.getLatestValidationForActor(actorId);
    const resumeHistory: HistoryEntry[] =
      pendingForActor?.context?.history?.map((entry) => ({ ...entry })) ?? [];
    const resumeStep = pendingForActor?.context?.nextStep;
    const detachedPending = pendingForActor
      ? validationManager.removeValidation(pendingForActor.request.id)
      : undefined;

    const userTurn: ConversationEntry = {
      role: "user",
      content: trimmedPrompt,
    };

    const workingHistory = [...existingHistory, userTurn];
    const conversationHistoryForAgent = this.toAgentHistory(workingHistory);

    const agentResult = await askAgent(
      {
        prompt: trimmedPrompt,
        history: conversationHistoryForAgent,
      },
      {
        config: this.config,
        initialToolHistory: resumeHistory.length ? resumeHistory : undefined,
        initialStep: resumeStep,
      }
    );

    const answer = agentResult.answer?.trim()
      ? agentResult.answer
      : DEFAULT_FAILURE_MESSAGE;
    let validationData = agentResult.validationRequest;
    const restoredPending = !validationData ? detachedPending : undefined;

    if (!validationData && restoredPending) {
      validationData = restoredPending.request;
    }

    const finalHistory: ConversationEntry[] = [
      ...workingHistory,
      { role: "assistant", content: answer },
    ];

    const updatedAt = new Date();
    const persistence = await this.persistConversation(
      actorId,
      finalHistory,
      updatedAt,
      input.sessionId
    );

    if (validationData && agentResult.continuation && persistence) {
      const context: PendingValidationContext = {
        actorId,
        sessionId: persistence.sessionId,
        messageId: persistence.messageId,
        continuation: agentResult.continuation,
        history: agentResult.history,
        nextStep: agentResult.nextStep,
        anpsStartedAt: requestStartedAt,
        userWaitMs: 0,
      };
      validationManager.attachContext(validationData.id, context);
    } else if (restoredPending) {
      if (restoredPending.context && persistence) {
        restoredPending.context = {
          ...restoredPending.context,
          actorId,
          sessionId: persistence.sessionId,
          messageId: persistence.messageId,
          anpsStartedAt: restoredPending.context.anpsStartedAt ?? requestStartedAt,
          userWaitMs: restoredPending.context.userWaitMs ?? 0,
        };
      }
      validationManager.restoreValidation(restoredPending);
      if (restoredPending.context) {
        validationManager.attachContext(
          restoredPending.request.id,
          restoredPending.context
        );
      }
    }

    if (persistence && !validationData) {
      const totalDurationMs = Date.now() - requestStartedAt;
      await this.autoSubmitAnpsIfEligible({
        actorId,
        sessionId: persistence.sessionId,
        history: agentResult.history,
        durationMs: totalDurationMs,
        agentComputeMs: totalDurationMs,
        answer,
      });
    }

    return {
      answer,
      history: finalHistory,
      updatedAt,
      sessionId: persistence?.sessionId,
      validationRequest: validationData,
    };
  }

  async getConversation(actorId: string): Promise<{
    history: ConversationEntry[];
    updatedAt: Date | null;
  } | null> {
    const resolvedActorId = actorId?.trim();
    if (!resolvedActorId) {
      return null;
    }

    const session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: resolvedActorId })
      .orderBy("updated_at", "desc")
      .first();

    if (!session) {
      return null;
    }

    const messages = await this.db<MessageRow>(MESSAGE_TABLE)
      .where({ session_id: session.id })
      .orderBy("created_at", "asc");

    const history: ConversationEntry[] = [];
    for (const message of messages) {
      if (message.question) {
        history.push({ role: "user", content: message.question });
      }
      if (message.answer) {
        history.push({ role: "assistant", content: message.answer });
      }
    }

    return {
      history,
      updatedAt: session.updated_at ? new Date(session.updated_at) : null,
    };
  }

  async handleValidationResponse(params: {
    actorId: string;
    id: string;
    approved: boolean;
    editedData?: Record<string, unknown>;
  }): Promise<PromptResult> {
    const actorId = params.actorId?.trim();
    if (!actorId) {
      throw new Error("Missing actor identifier");
    }

    const id = params.id?.trim();
    if (!id) {
      throw new Error("Missing validation id");
    }

    const pending = validationManager.getPendingValidation(id);
    if (!pending) {
      throw new Error("Validation request not found or expired");
    }

    const context = pending.context;
    if (!context) {
      throw new Error("No continuation context available for this validation");
    }

    if (context.actorId !== actorId) {
      throw new Error("Validation does not belong to this actor");
    }

    const timestampValue = pending.request.timestamp;
    const requestTimestamp =
      timestampValue instanceof Date
        ? timestampValue.getTime()
        : new Date(timestampValue).getTime();
    const waitMs = Number.isFinite(requestTimestamp)
      ? Math.max(0, Date.now() - requestTimestamp)
      : 0;
    const accumulatedUserWaitMs = (context.userWaitMs ?? 0) + waitMs;

    const updatedAt = new Date();

    if (!params.approved) {
      validationManager.respondToValidation({ id, approved: false });
      await this.updateConversationMessage(
        context.sessionId,
        context.messageId,
        CANCEL_MESSAGE,
        updatedAt
      );

      const conversation = await this.getConversation(actorId);
      return {
        answer: CANCEL_MESSAGE,
        history: conversation?.history ?? [],
        updatedAt,
      };
    }

    // Add a user message indicating approval
    const approvalMessage: ConversationEntry = {
      role: "user",
      content: "✓ Approved",
    };
    await this.addMessageToConversation(
      context.sessionId,
      approvalMessage.role,
      approvalMessage.content,
      updatedAt
    );

    if (!context.continuation) {
      throw new Error("No continuation handler registered for validation");
    }

    let agentResult: ValidationContinuationResult;
    try {
      agentResult = await context.continuation({
        approved: true,
        editedData: params.editedData,
      });
    } catch (error) {
      validationManager.respondToValidation({ id, approved: false });
      throw error;
    }

    const answer = agentResult.answer?.trim()
      ? agentResult.answer
      : DEFAULT_FAILURE_MESSAGE;

    // Add the assistant's response as a new message instead of updating the old one
    const newMessageId = await this.addMessageToConversation(
      context.sessionId,
      "assistant",
      answer,
      updatedAt
    );

    validationManager.respondToValidation({
      id,
      approved: true,
      editedData: params.editedData,
    });

    const nextValidation = agentResult.validationRequest;
    if (nextValidation && agentResult.continuation) {
      const nextContext: PendingValidationContext = {
        actorId,
        sessionId: context.sessionId,
        messageId: newMessageId,
        continuation: agentResult.continuation,
        history: agentResult.history,
        nextStep: agentResult.nextStep,
        anpsStartedAt: context.anpsStartedAt,
        userWaitMs: accumulatedUserWaitMs,
      };
      validationManager.attachContext(nextValidation.id, nextContext);
    }

    const conversation = await this.getConversation(actorId);

    if (!nextValidation) {
      const durationMs = context.anpsStartedAt
        ? Math.max(0, Date.now() - context.anpsStartedAt)
        : 0;
      const agentComputeMs = Math.max(0, durationMs - accumulatedUserWaitMs);
      await this.autoSubmitAnpsIfEligible({
        actorId,
        sessionId: context.sessionId,
        history: agentResult.history,
        durationMs,
        agentComputeMs,
        answer,
      });
    }

    return {
      answer,
      history: conversation?.history ?? [],
      updatedAt,
      sessionId: context.sessionId,
      validationRequest: nextValidation as ValidationRequest | undefined,
    };
  }

  private toAgentHistory(entries: ConversationEntry[]): HistoryEntry[] {
    return entries.map((entry) => ({
      tool_name: "conversation",
      tool_args: { role: entry.role },
      tool_result: { content: entry.content },
    }));
  }

  private async persistConversation(
    actorId: string,
    history: ConversationEntry[],
    updatedAt: Date,
    sessionId?: string
  ): Promise<{ sessionId: string; messageId: string } | null> {
    // Get or create session
    let session: ConversationRow | undefined;

    if (sessionId) {
      session = await this.db<ConversationRow>(CONVERSATION_TABLE)
        .where({ id: sessionId, actor_id: actorId })
        .first();

      if (!session) {
        throw new Error("Session not found");
      }

      // Update session timestamp
      await this.db(CONVERSATION_TABLE)
        .where({ id: session.id })
        .update({ updated_at: updatedAt });
    } else {
      // Check for existing session (fallback to old behavior)
      session = await this.db<ConversationRow>(CONVERSATION_TABLE)
        .where({ actor_id: actorId })
        .orderBy("updated_at", "desc")
        .first();

      if (!session) {
        const newSessionId = generateId("sess");
        const firstUserMessage = history.find((h) => h.role === "user");
        const title = firstUserMessage
          ? firstUserMessage.content.length > 50
            ? firstUserMessage.content.substring(0, 50) + "..."
            : firstUserMessage.content
          : "New Conversation";

        await this.db(CONVERSATION_TABLE).insert({
          id: newSessionId,
          actor_id: actorId,
          title,
          created_at: updatedAt,
          updated_at: updatedAt,
        });
        session = {
          id: newSessionId,
          actor_id: actorId,
          title,
          created_at: updatedAt,
          updated_at: updatedAt,
        };
      } else {
        // Update session timestamp
        await this.db(CONVERSATION_TABLE)
          .where({ id: session.id })
          .update({ updated_at: updatedAt });
      }
    }

    let result: { sessionId: string; messageId: string } | null = null;

    // Extract the last question-answer pair from history
    // (We only persist the new exchange, not the entire history)
    if (history.length >= 2) {
      const lastQuestion = history[history.length - 2];
      const lastAnswer = history[history.length - 1];

      if (lastQuestion.role === "user" && lastAnswer.role === "assistant") {
        const messageId = generateId("msg");
        await this.db(MESSAGE_TABLE).insert({
          id: messageId,
          session_id: session.id,
          question: lastQuestion.content,
          answer: lastAnswer.content,
          created_at: updatedAt,
        });
        result = { sessionId: session.id, messageId };
      }
    }

    return result;
  }

  private async updateConversationMessage(
    sessionId: string,
    messageId: string,
    answer: string,
    updatedAt: Date
  ): Promise<void> {
    await this.db(MESSAGE_TABLE).where({ id: messageId }).update({
      answer,
    });

    await this.db(CONVERSATION_TABLE)
      .where({ id: sessionId })
      .update({ updated_at: updatedAt });
  }

  private async addMessageToConversation(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    timestamp: Date
  ): Promise<string> {
    const messageId = generateId("msg");

    // If it's a user message, we need to store it with empty answer for now
    // If it's an assistant message, we store it as a complete Q&A pair with empty question
    if (role === "user") {
      await this.db(MESSAGE_TABLE).insert({
        id: messageId,
        session_id: sessionId,
        question: content,
        answer: "",
        created_at: timestamp,
      });
    } else {
      await this.db(MESSAGE_TABLE).insert({
        id: messageId,
        session_id: sessionId,
        question: "",
        answer: content,
        created_at: timestamp,
      });
    }

    await this.db(CONVERSATION_TABLE)
      .where({ id: sessionId })
      .update({ updated_at: timestamp });

    return messageId;
  }

  async listConversations(actorId: string): Promise<ConversationSummary[]> {
    const sessions = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: actorId })
      .orderBy("updated_at", "desc");

    const summaries: ConversationSummary[] = [];

    for (const session of sessions) {
      const messageCount = await this.db(MESSAGE_TABLE)
        .where({ session_id: session.id })
        .count("* as count")
        .first();

      summaries.push({
        id: session.id,
        title: session.title || "New Conversation",
        createdAt: new Date(session.created_at),
        updatedAt: new Date(session.updated_at),
        messageCount: Number(messageCount?.count || 0),
      });
    }

    return summaries;
  }

  async createConversation(
    actorId: string,
    title?: string
  ): Promise<{ id: string; title: string }> {
    const sessionId = generateId("sess");
    const now = new Date();

    await this.db(CONVERSATION_TABLE).insert({
      id: sessionId,
      actor_id: actorId,
      title: title || "New Conversation",
      created_at: now,
      updated_at: now,
    });

    return {
      id: sessionId,
      title: title || "New Conversation",
    };
  }

  async deleteConversation(
    actorId: string,
    sessionId: string
  ): Promise<boolean> {
    const session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ id: sessionId, actor_id: actorId })
      .first();

    if (!session) {
      return false;
    }

    await this.db(CONVERSATION_TABLE).where({ id: sessionId }).delete();
    return true;
  }

  async updateConversationTitle(
    actorId: string,
    sessionId: string,
    title: string
  ): Promise<boolean> {
    const result = await this.db(CONVERSATION_TABLE)
      .where({ id: sessionId, actor_id: actorId })
      .update({ title, updated_at: new Date() });

    return result > 0;
  }

  async getConversationBySession(
    actorId: string,
    sessionId: string
  ): Promise<{
    history: ConversationEntry[];
    updatedAt: Date | null;
  } | null> {
    const session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ id: sessionId, actor_id: actorId })
      .first();

    if (!session) {
      return null;
    }

    const messages = await this.db<MessageRow>(MESSAGE_TABLE)
      .where({ session_id: session.id })
      .orderBy("created_at", "asc");

    const history: ConversationEntry[] = [];
    for (const message of messages) {
      if (message.question) {
        history.push({ role: "user", content: message.question });
      }
      if (message.answer) {
        history.push({ role: "assistant", content: message.answer });
      }
    }

    return {
      history,
      updatedAt: session.updated_at ? new Date(session.updated_at) : null,
    };
  }
}

export default AssistantModuleService;
