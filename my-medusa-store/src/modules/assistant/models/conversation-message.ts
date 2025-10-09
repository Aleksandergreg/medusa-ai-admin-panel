import { Entity, PrimaryKey, Property, ManyToOne, Index } from "@mikro-orm/core";
import { ConversationSession } from "./conversation-session";

@Entity({ tableName: "conversation_message" })
export class ConversationMessage {
  @PrimaryKey({ type: "string" })
  id!: string;

  @ManyToOne(() => ConversationSession, { fieldName: "session_id" })
  @Index()
  session!: ConversationSession;

  @Property({ type: "text" })
  question!: string;

  @Property({ type: "text", nullable: true })
  answer?: string | null;

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at = new Date();
}
