import type { Knex } from "knex";
import { ConversationRepository } from "../repositories/conversation-repository";
import { MessageRepository } from "../repositories/message-repository";
import { ConversationMapper } from "../mappers/conversation-mapper";
import { ConversationEntry, ConversationSummary } from "../lib/types";
import { generateId } from "../utils/idGenerator";

export interface GetConversationResult {
  history: ConversationEntry[];
  updatedAt: Date | null;
}

export interface PersistConversationResult {
  sessionId: string;
  messageId: string;
}

/**
 * Service layer for conversation management.
 * Orchestrates repositories and mappers to provide business logic for conversations.
 */
export class ConversationService {
  private readonly conversationRepo: ConversationRepository;
  private readonly messageRepo: MessageRepository;

  constructor(db: Knex) {
    this.conversationRepo = new ConversationRepository(db);
    this.messageRepo = new MessageRepository(db);
  }

  /**
   * Get the most recent conversation for an actor, including full history.
   */
  async getConversation(
    actorId: string
  ): Promise<GetConversationResult | null> {
    const resolvedActorId = actorId?.trim();
    if (!resolvedActorId) {
      return null;
    }

    const session = await this.conversationRepo.getLatestByActor(
      resolvedActorId
    );

    if (!session) {
      return null;
    }

    const messages = await this.messageRepo.getBySession(session.id);
    const history = ConversationMapper.messagesToConversationEntries(messages);

    return {
      history,
      updatedAt: session.updated_at ? new Date(session.updated_at) : null,
    };
  }

  /**
   * Get a specific conversation by session ID.
   */
  async getConversationBySession(
    actorId: string,
    sessionId: string
  ): Promise<GetConversationResult | null> {
    const session = await this.conversationRepo.getByIdAndActor(
      sessionId,
      actorId
    );

    if (!session) {
      return null;
    }

    const messages = await this.messageRepo.getBySession(session.id);
    const history = ConversationMapper.messagesToConversationEntries(messages);

    return {
      history,
      updatedAt: session.updated_at ? new Date(session.updated_at) : null,
    };
  }

  /**
   * Persist a new conversation exchange (question + answer pair).
   * Creates a new session if sessionId is not provided or updates an existing one.
   */
  async persistConversation(
    actorId: string,
    history: ConversationEntry[],
    updatedAt: Date,
    sessionId?: string
  ): Promise<PersistConversationResult | null> {
    let session;

    if (sessionId) {
      // Update existing session
      session = await this.conversationRepo.getByIdAndActor(sessionId, actorId);

      if (!session) {
        throw new Error("Session not found");
      }

      await this.conversationRepo.update(session.id, { updatedAt });
    } else {
      // Get or create session
      session = await this.conversationRepo.getLatestByActor(actorId);

      if (!session) {
        const newSessionId = generateId("sess");
        const title = ConversationMapper.generateTitle(history);

        await this.conversationRepo.create({
          id: newSessionId,
          actorId,
          title,
          createdAt: updatedAt,
          updatedAt,
        });

        session = {
          id: newSessionId,
          actor_id: actorId,
          title,
          created_at: updatedAt,
          updated_at: updatedAt,
        };
      } else {
        await this.conversationRepo.update(session.id, { updatedAt });
      }
    }

    // Extract and persist the last Q&A pair
    const qaPair = ConversationMapper.extractLastQAPair(history);

    if (qaPair) {
      const messageId = generateId("msg");
      await this.messageRepo.create({
        id: messageId,
        sessionId: session.id,
        question: qaPair.question,
        answer: qaPair.answer,
        createdAt: updatedAt,
      });

      return { sessionId: session.id, messageId };
    }

    return null;
  }

  /**
   * Update an existing message's answer and the session timestamp.
   */
  async updateConversationMessage(
    sessionId: string,
    messageId: string,
    answer: string,
    updatedAt: Date
  ): Promise<void> {
    await this.messageRepo.updateAnswer(messageId, answer);
    await this.conversationRepo.update(sessionId, { updatedAt });
  }

  /**
   * Add a new message to an existing conversation.
   * For user messages, the answer is empty; for assistant messages, the question is empty.
   */
  async addMessageToConversation(
    sessionId: string,
    role: "user" | "assistant",
    content: string,
    timestamp: Date
  ): Promise<string> {
    const messageId = generateId("msg");

    if (role === "user") {
      await this.messageRepo.create({
        id: messageId,
        sessionId,
        question: content,
        answer: "",
        createdAt: timestamp,
      });
    } else {
      await this.messageRepo.create({
        id: messageId,
        sessionId,
        question: "",
        answer: content,
        createdAt: timestamp,
      });
    }

    await this.conversationRepo.update(sessionId, { updatedAt: timestamp });

    return messageId;
  }

  /**
   * List all conversations for an actor with summary information.
   */
  async listConversations(actorId: string): Promise<ConversationSummary[]> {
    const sessions = await this.conversationRepo.listByActor(actorId);
    const summaries: ConversationSummary[] = [];

    for (const session of sessions) {
      const messageCount = await this.messageRepo.countBySession(session.id);

      summaries.push({
        id: session.id,
        title: session.title || "New Conversation",
        createdAt: new Date(session.created_at),
        updatedAt: new Date(session.updated_at),
        messageCount,
      });
    }

    return summaries;
  }

  /**
   * Create a new empty conversation session.
   */
  async createConversation(
    actorId: string,
    title?: string
  ): Promise<{ id: string; title: string }> {
    const sessionId = generateId("sess");
    const now = new Date();
    const conversationTitle = title || "New Conversation";

    await this.conversationRepo.create({
      id: sessionId,
      actorId,
      title: conversationTitle,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: sessionId,
      title: conversationTitle,
    };
  }

  /**
   * Delete a conversation session and all its messages (cascade delete).
   */
  async deleteConversation(
    actorId: string,
    sessionId: string
  ): Promise<boolean> {
    const session = await this.conversationRepo.getByIdAndActor(
      sessionId,
      actorId
    );

    if (!session) {
      return false;
    }

    await this.conversationRepo.delete(sessionId);
    return true;
  }

  /**
   * Update a conversation's title.
   */
  async updateConversationTitle(
    actorId: string,
    sessionId: string,
    title: string
  ): Promise<boolean> {
    const result = await this.conversationRepo.updateTitle(
      sessionId,
      actorId,
      title,
      new Date()
    );

    return result > 0;
  }
}
