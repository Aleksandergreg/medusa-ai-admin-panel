import {
  ContainerRegistrationKeys,
  MedusaService,
} from "@medusajs/framework/utils";
import type { Knex } from "knex";
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
  HistoryEntry,
  MessageRow,
  PromptInput,
  PromptResult,
  ValidationRequest,
} from "./lib/types";
import { generateId } from "./utils/idGenerator";

const CONVERSATION_TABLE = "conversation_session";
const MESSAGE_TABLE = "conversation_message";

const DEFAULT_FAILURE_MESSAGE =
  "Sorry, I could not find an answer to your question.";
const CANCEL_MESSAGE =
  `## ❌ Action Cancelled\n\n` +
  `No changes were made to your store. The operation has been cancelled as requested.\n\n` +
  `Feel free to ask me to do something else!`;

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;

  constructor(
    container: Record<string, unknown>,
    options: AssistantModuleOptions = DEFAULT_ASSISTANT_OPTIONS
  ) {
    super(container, options);
    this.config = { ...DEFAULT_ASSISTANT_OPTIONS, ...options };
  }

  private get db(): Knex {
    return this.__container__[ContainerRegistrationKeys.PG_CONNECTION] as Knex;
  }

  public getConfig(): AssistantModuleOptions {
    return this.config;
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

    const existing = await this.getConversation(actorId);
    const existingHistory = existing?.history ?? [];

    const pendingForActor =
      validationManager.getLatestValidationForActor(actorId);
    const resumeHistory: HistoryEntry[] =
      pendingForActor?.context?.history?.map((entry) => ({ ...entry })) ?? [];
    const resumeStep = pendingForActor?.context?.nextStep;

    if (pendingForActor) {
      validationManager.removeValidation(pendingForActor.request.id);
    }

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
    const validationData = agentResult.validationRequest;

    const finalHistory: ConversationEntry[] = [
      ...workingHistory,
      { role: "assistant", content: answer },
    ];

    const updatedAt = new Date();
    const persistence = await this.persistConversation(
      actorId,
      finalHistory,
      updatedAt
    );

    if (validationData && agentResult.continuation && persistence) {
      const context: PendingValidationContext = {
        actorId,
        sessionId: persistence.sessionId,
        messageId: persistence.messageId,
        continuation: agentResult.continuation,
        history: agentResult.history,
        nextStep: agentResult.nextStep,
      };
      validationManager.attachContext(validationData.id, context);
    }

    return {
      answer,
      history: finalHistory,
      updatedAt,
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
      history.push({ role: "user", content: message.question });
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

    await this.updateConversationMessage(
      context.sessionId,
      context.messageId,
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
        messageId: context.messageId,
        continuation: agentResult.continuation,
        history: agentResult.history,
        nextStep: agentResult.nextStep,
      };
      validationManager.attachContext(nextValidation.id, nextContext);
    }

    const conversation = await this.getConversation(actorId);

    return {
      answer,
      history: conversation?.history ?? [],
      updatedAt,
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
    updatedAt: Date
  ): Promise<{ sessionId: string; messageId: string } | null> {
    // Get or create session
    let session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: actorId })
      .first();

    if (!session) {
      const sessionId = generateId("sess");
      await this.db(CONVERSATION_TABLE).insert({
        id: sessionId,
        actor_id: actorId,
        created_at: updatedAt,
        updated_at: updatedAt,
      });
      session = {
        id: sessionId,
        actor_id: actorId,
        created_at: updatedAt,
        updated_at: updatedAt,
      };
    } else {
      // Update session timestamp
      await this.db(CONVERSATION_TABLE)
        .where({ id: session.id })
        .update({ updated_at: updatedAt });
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
}

export default AssistantModuleService;
