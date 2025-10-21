import type { Knex } from "knex";
import { MessageRow } from "../lib/types";

const MESSAGE_TABLE = "conversation_message";

export interface CreateMessageParams {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  createdAt: Date;
}

/**
 * Repository layer for conversation_message table operations.
 * Handles all database queries related to conversation messages.
 */
export class MessageRepository {
  constructor(private readonly db: Knex) {}

  /**
   * Get all messages for a specific conversation session, ordered by creation time.
   */
  async getBySession(sessionId: string): Promise<MessageRow[]> {
    return this.db<MessageRow>(MESSAGE_TABLE)
      .where({ session_id: sessionId })
      .orderBy("created_at", "asc");
  }

  /**
   * Create a new message in a conversation.
   */
  async create(params: CreateMessageParams): Promise<void> {
    await this.db(MESSAGE_TABLE).insert({
      id: params.id,
      session_id: params.sessionId,
      question: params.question,
      answer: params.answer,
      created_at: params.createdAt,
    });
  }

  /**
   * Update the answer field of an existing message.
   */
  async updateAnswer(messageId: string, answer: string): Promise<number> {
    return this.db(MESSAGE_TABLE).where({ id: messageId }).update({
      answer,
    });
  }

  /**
   * Count messages for a specific session.
   */
  async countBySession(sessionId: string): Promise<number> {
    const result = await this.db(MESSAGE_TABLE)
      .where({ session_id: sessionId })
      .count("* as count")
      .first();

    return Number(result?.count || 0);
  }
}
