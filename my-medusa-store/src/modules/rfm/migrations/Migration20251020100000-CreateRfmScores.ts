import { Migration } from "@mikro-orm/migrations";

export class Migration20251020100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "rfm_scores" (
        "customer_id" text not null,
        "recency_days" integer null,
        "frequency_365d" integer not null,
        "monetary_365d_cents" bigint not null,
        "r_score" smallint not null,
        "f_score" smallint not null,
        "m_score" smallint not null,
        "rfm_segment" text not null,
        "rfm_index" smallint not null,
        "calculated_at" timestamptz not null default now(),
        constraint "rfm_scores_pkey" primary key ("customer_id")
      );
    `);

    this.addSql(
      'create index if not exists "idx_rfm_scores_segment" on "rfm_scores" ("rfm_segment");'
    );
    this.addSql(
      'create index if not exists "idx_rfm_scores_score_combo" on "rfm_scores" ("r_score", "f_score", "m_score");'
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "rfm_scores" cascade;');
  }
}
