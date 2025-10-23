import {
  ContainerRegistrationKeys,
  MedusaService,
} from "@medusajs/framework/utils";
import type { Knex } from "knex";
import { askAgent } from "./agent/ask";
import { AssistantModuleOptions, DEFAULT_ASSISTANT_OPTIONS } from "./config";
import { validationManager } from "./domain/validation/manager";
import type { PendingValidationContext } from "./domain/validation/types";
import {
  ConversationEntry,
  ConversationSummary,
  HistoryEntry,
  PromptInput,
  PromptResult,
} from "./lib/types";
import {
  AgentNpsInsertInput,
  AgentNpsMetrics,
  AgentNpsRow,
} from "./domain/anps/types";
import { ConversationService } from "./services/conversation-service";
import { ConversationMapper } from "./mappers/conversation-mapper";
import { AnpsService } from "./services/anps-service";
import type { AnpsRecentFilter } from "./repositories/anps-repository";
import { ValidationService } from "./services/validation-service";

const DEFAULT_FAILURE_MESSAGE =
  "Sorry, I could not find an answer to your question.";

// Simple in-memory map to track active AbortControllers
const activeRequests = new Map<string, AbortController>();

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;
  private conversationService: ConversationService | null = null;
  private anpsService: AnpsService | null = null;
  private validationService: ValidationService | null = null;

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

  private getConversationService(): ConversationService {
    if (!this.conversationService) {
      this.conversationService = new ConversationService(this.db);
    }
    return this.conversationService;
  }

  private getAnpsService(): AnpsService {
    if (!this.anpsService) {
      this.anpsService = new AnpsService(this.db, this.config);
    }
    return this.anpsService;
  }

  private getValidationService(): ValidationService {
    if (!this.validationService) {
      this.validationService = new ValidationService(
        this.db,
        this.config,
        this.getConversationService(),
        this.getAnpsService()
      );
    }
    return this.validationService;
  }

  public getConfig(): AssistantModuleOptions {
    return this.config;
  }

  async recordAgentNps(input: AgentNpsInsertInput): Promise<{ id: string }> {
    return this.getAnpsService().recordAgentNps(input);
  }

  async getAgentNpsMetrics(): Promise<AgentNpsMetrics> {
    return this.getAnpsService().getAgentNpsMetrics();
  }

  async listRecentAgentNps(
    limit = 20,
    filters: AnpsRecentFilter = {}
  ): Promise<AgentNpsRow[]> {
    return this.getAnpsService().listRecentAgentNps(limit, filters);
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

    // Create an AbortController for this request
    const abortController = new AbortController();
    const requestKey = input.sessionId
      ? `${actorId}:${input.sessionId}`
      : actorId;

    // Store the AbortController so it can be cancelled
    activeRequests.set(requestKey, abortController);

    const agentResult = await askAgent(
      {
        prompt: trimmedPrompt,
        history: conversationHistoryForAgent,
        abortSignal: abortController.signal,
      },
      {
        config: this.config,
        initialToolHistory: resumeHistory.length ? resumeHistory : undefined,
        initialStep: resumeStep,
      }
    ).finally(() => {
      // Remove from active requests when done
      activeRequests.delete(requestKey);
    });
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
        prompt: trimmedPrompt,
      };
      validationManager.attachContext(validationData.id, context);
    } else if (restoredPending) {
      if (restoredPending.context && persistence) {
        restoredPending.context = {
          ...restoredPending.context,
          actorId,
          sessionId: persistence.sessionId,
          messageId: persistence.messageId,
          anpsStartedAt:
            restoredPending.context.anpsStartedAt ?? requestStartedAt,
          userWaitMs: restoredPending.context.userWaitMs ?? 0,
          prompt: restoredPending.context.prompt ?? trimmedPrompt,
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
      this.getAnpsService().scheduleAnpsSubmission({
        actorId,
        sessionId: persistence.sessionId,
        history: agentResult.history,
        durationMs: totalDurationMs,
        agentComputeMs: totalDurationMs,
        answer,
        prompt: trimmedPrompt,
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
    return this.getConversationService().getConversation(actorId);
  }

  async handleValidationResponse(params: {
    actorId: string;
    id: string;
    approved: boolean;
    editedData?: Record<string, unknown>;
  }): Promise<PromptResult> {
    return this.getValidationService().handleValidationResponse(params);
  }

  private toAgentHistory(entries: ConversationEntry[]): HistoryEntry[] {
    return ConversationMapper.toAgentHistory(entries);
  }

  private async persistConversation(
    actorId: string,
    history: ConversationEntry[],
    updatedAt: Date,
    sessionId?: string
  ): Promise<{ sessionId: string; messageId: string } | null> {
    return this.getConversationService().persistConversation(
      actorId,
      history,
      updatedAt,
      sessionId
    );
  }

  private async updateConversationMessage(
    sessionId: string,
    messageId: string,
    answer: string,
    updatedAt: Date
  ): Promise<void> {
    return this.getConversationService().updateConversationMessage(
      sessionId,
      messageId,
      answer,
      updatedAt
    );
  }

  private async addMessageToConversation(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    timestamp: Date
  ): Promise<string> {
    return this.getConversationService().addMessageToConversation(
      sessionId,
      role,
      content,
      timestamp
    );
  }

  async listConversations(actorId: string): Promise<ConversationSummary[]> {
    return this.getConversationService().listConversations(actorId);
  }

  async createConversation(
    actorId: string,
    title?: string
  ): Promise<{ id: string; title: string }> {
    return this.getConversationService().createConversation(actorId, title);
  }

  async deleteConversation(
    actorId: string,
    sessionId: string
  ): Promise<boolean> {
    return this.getConversationService().deleteConversation(actorId, sessionId);
  }

  async updateConversationTitle(
    actorId: string,
    sessionId: string,
    title: string
  ): Promise<boolean> {
    return this.getConversationService().updateConversationTitle(
      actorId,
      sessionId,
      title
    );
  }

  async getConversationBySession(
    actorId: string,
    sessionId: string
  ): Promise<{
    history: ConversationEntry[];
    updatedAt: Date | null;
  } | null> {
    return this.getConversationService().getConversationBySession(
      actorId,
      sessionId
    );
  }

  /**
   * Cancel an ongoing assistant request
   * @returns true if a request was cancelled, false if no active request was found
   */
  cancelRequest(actorId: string, sessionId?: string): boolean {
    const requestKey = sessionId ? `${actorId}:${sessionId}` : actorId;
    const controller = activeRequests.get(requestKey);

    if (controller) {
      controller.abort();
      activeRequests.delete(requestKey);
      return true;
    }

    return false;
  }
}

export default AssistantModuleService;
