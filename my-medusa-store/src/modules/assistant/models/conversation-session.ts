import {
  Entity,
  PrimaryKey,
  Property,
  OneToMany,
  Collection,
} from "@mikro-orm/core";
import { ConversationMessage } from "./conversation-message";

@Entity({ tableName: "conversation_session" })
export class ConversationSession {
  @PrimaryKey({ type: "string" })
  id!: string;

  @Property({ type: "string" })
  actor_id!: string;

  @Property({ type: "string", nullable: true })
  title?: string;

  @OneToMany(() => ConversationMessage, (message) => message.session)
  messages = new Collection<ConversationMessage>(this);

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at = new Date();

  @Property({
    type: "timestamptz",
    defaultRaw: "now()",
    onUpdate: () => new Date(),
  })
  updated_at = new Date();
}
