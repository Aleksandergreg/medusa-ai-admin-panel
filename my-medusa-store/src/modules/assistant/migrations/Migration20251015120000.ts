import { Migration } from "@mikro-orm/migrations";

export class Migration20251015120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'delete from "conversation_session" where session_id in (select session_id from (select session_id, row_number() over (partition by actor_id order by updated_at desc, session_id desc) as row_num from "conversation_session") ranked where row_num > 1);'
    );

    this.addSql(
      'drop index if exists "conversation_session_actor_id_idx";'
    );

    this.addSql(
      'drop index if exists "conversation_session_actor_id_unique";'
    );

    this.addSql(
      'alter table "conversation_session" drop constraint if exists "conversation_session_pkey";'
    );

    this.addSql(
      'alter table "conversation_session" drop column if exists "session_id";'
    );

    this.addSql(
      'alter table "conversation_session" add constraint "conversation_session_pkey" primary key ("actor_id");'
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "conversation_session" drop constraint if exists "conversation_session_pkey";'
    );

    this.addSql(
      'alter table "conversation_session" add column "session_id" varchar(255);'
    );

    this.addSql(
      'update "conversation_session" set "session_id" = concat(\'legacy-\', "actor_id") where "session_id" is null;'
    );

    this.addSql(
      'alter table "conversation_session" alter column "session_id" set not null;'
    );

    this.addSql(
      'alter table "conversation_session" add constraint "conversation_session_pkey" primary key ("session_id");'
    );

    this.addSql(
      'create index if not exists "conversation_session_actor_id_idx" on "conversation_session" ("actor_id");'
    );
  }
}
