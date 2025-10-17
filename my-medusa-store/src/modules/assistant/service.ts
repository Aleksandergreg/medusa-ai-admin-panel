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
  ConversationSummary,
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

    const existing = input.sessionId
      ? await this.getConversationBySession(actorId, input.sessionId)
      : await this.getConversation(actorId);
    const existingHistory = existing?.history ?? [];

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
      };
      validationManager.attachContext(validationData.id, context);
    } else if (restoredPending) {
      if (restoredPending.context && persistence) {
        restoredPending.context = {
          ...restoredPending.context,
          actorId,
          sessionId: persistence.sessionId,
          messageId: persistence.messageId,
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
      };
      validationManager.attachContext(nextValidation.id, nextContext);
    }

    const conversation = await this.getConversation(actorId);

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
