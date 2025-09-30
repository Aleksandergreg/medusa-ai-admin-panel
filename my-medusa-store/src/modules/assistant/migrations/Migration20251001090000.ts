import { Migration } from "@mikro-orm/migrations";

export class Migration20251001090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table if exists "conversation_session" add column if not exists "actor_id" varchar(255);'
    );
    this.addSql(
      'update "conversation_session" set "actor_id" = \'legacy\' where "actor_id" is null;'
    );
    this.addSql(
      'alter table if exists "conversation_session" alter column "actor_id" set not null;'
    );
    this.addSql(
      'create index if not exists "conversation_session_actor_id_idx" on "conversation_session" ("actor_id");'
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'drop index if exists "conversation_session_actor_id_idx";'
    );
    this.addSql(
      'alter table if exists "conversation_session" drop column if exists "actor_id";'
    );
  }
}
