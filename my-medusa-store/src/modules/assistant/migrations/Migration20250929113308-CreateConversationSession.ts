import { Migration } from '@mikro-orm/migrations';

export class Migration20250929113308 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "conversation_session" ("session_id" varchar(255) not null, "history" jsonb null, "updated_at" timestamptz not null default now(), constraint "conversation_session_pkey" primary key ("session_id"));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "conversation_session" cascade;`);
  }

}
