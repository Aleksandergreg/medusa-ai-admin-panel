import type { Knex } from "knex";
import { ConversationRow } from "../lib/types";

const CONVERSATION_TABLE = "conversation_session";

export interface CreateConversationParams {
  id: string;
  actorId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateConversationParams {
  updatedAt: Date;
  title?: string;
}

/**
 * Repository layer for conversation_session table operations.
 * Handles all database queries related to conversation sessions.
 */
export class ConversationRepository {
  constructor(private readonly db: Knex) {}

  /**
   * Get the most recent conversation session for an actor.
   */
  async getLatestByActor(actorId: string): Promise<ConversationRow | null> {
    const session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: actorId })
      .orderBy("updated_at", "desc")
      .first();

    return session || null;
  }

  /**
   * Get a specific conversation session by ID and actor.
   */
  async getByIdAndActor(
    sessionId: string,
    actorId: string
  ): Promise<ConversationRow | null> {
    const session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ id: sessionId, actor_id: actorId })
      .first();

    return session || null;
  }

  /**
   * Create a new conversation session.
   */
  async create(params: CreateConversationParams): Promise<void> {
    await this.db(CONVERSATION_TABLE).insert({
      id: params.id,
      actor_id: params.actorId,
      title: params.title,
      created_at: params.createdAt,
      updated_at: params.updatedAt,
    });
  }

  /**
   * Update a conversation session's timestamp and optionally its title.
   */
  async update(
    sessionId: string,
    params: UpdateConversationParams
  ): Promise<number> {
    const updates: Record<string, unknown> = {
      updated_at: params.updatedAt,
    };

    if (params.title !== undefined) {
      updates.title = params.title;
    }

    return this.db(CONVERSATION_TABLE).where({ id: sessionId }).update(updates);
  }

  /**
   * Update a conversation session's title for a specific actor.
   */
  async updateTitle(
    sessionId: string,
    actorId: string,
    title: string,
    updatedAt: Date
  ): Promise<number> {
    return this.db(CONVERSATION_TABLE)
      .where({ id: sessionId, actor_id: actorId })
      .update({ title, updated_at: updatedAt });
  }

  /**
   * Delete a conversation session.
   */
  async delete(sessionId: string): Promise<number> {
    return this.db(CONVERSATION_TABLE).where({ id: sessionId }).delete();
  }

  /**
   * List all conversation sessions for an actor, ordered by most recent.
   */
  async listByActor(actorId: string): Promise<ConversationRow[]> {
    return this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: actorId })
      .orderBy("updated_at", "desc");
  }

  /**
   * Count messages in a specific session (for summary purposes).
   */
  async getMessageCount(sessionId: string): Promise<number> {
    const result = await this.db("conversation_message")
      .where({ session_id: sessionId })
      .count("* as count")
      .first();

    return Number(result?.count || 0);
  }
}
