import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { ConversationEntry } from "../lib/types";

@Entity({ tableName: "conversation_session" })
export class ConversationSession {
  @PrimaryKey({ type: "string" })
  session_id!: string;

  @Property({ type: "jsonb", nullable: true })
  history!: ConversationEntry[];

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  updated_at = new Date();
}
