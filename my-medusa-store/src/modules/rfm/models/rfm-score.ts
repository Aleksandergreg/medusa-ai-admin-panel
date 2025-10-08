import { Entity, Index, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "rfm_scores" })
@Index({
  name: "idx_rfm_scores_segment",
  properties: ["rfm_segment"]
})
@Index({
  name: "idx_rfm_scores_score_combo",
  properties: ["r_score", "f_score", "m_score"]
})
export class RfmScore {
  @PrimaryKey({ type: "string" })
  customer_id!: string;

  @Property({ type: "int", nullable: true })
  recency_days?: number | null;

  @Property({ type: "int" })
  frequency_365d!: number;

  @Property({ type: "bigint" })
  monetary_365d_cents!: bigint | number;

  @Property({ type: "smallint" })
  r_score!: number;

  @Property({ type: "smallint" })
  f_score!: number;

  @Property({ type: "smallint" })
  m_score!: number;

  @Property({ type: "text" })
  rfm_segment!: string;

  @Property({ type: "smallint" })
  rfm_index!: number;

  @Property({
    type: "timestamptz",
    defaultRaw: "now()"
  })
  calculated_at: Date = new Date();
}
