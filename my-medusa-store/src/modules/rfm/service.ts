import {
  ContainerRegistrationKeys,
  MedusaService
} from "@medusajs/framework/utils";
import type { Knex } from "knex";
import {
  DEFAULT_RFM_OPTIONS,
  RfmModuleOptions,
  SegmentDefinition
} from "./config";
import { computeRfmScores, ComputeResult } from "./lib/metrics-calculator";
import {
  RawMetricRecord,
  ScoredMetricRecord
} from "./lib/types";

export type ScoreRow = {
  customer_id: string;
  recency_days: number | null;
  frequency_365d: number;
  monetary_365d_cents: number;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_segment: string;
  rfm_index: number;
  calculated_at: Date;
};

type ServiceConstructorOptions = Partial<RfmModuleOptions>;

class RfmModuleService extends MedusaService({}) {
  private readonly options: RfmModuleOptions;

  constructor(
    container: Record<string, unknown>,
    options: ServiceConstructorOptions = {}
  ) {
    super(container, options);
    this.options = {
      ...DEFAULT_RFM_OPTIONS,
      ...options,
      weights: {
        ...DEFAULT_RFM_OPTIONS.weights,
        ...(options.weights ?? {})
      },
      segments: options.segments ?? DEFAULT_RFM_OPTIONS.segments
    };
  }

  private get db(): Knex {
    return this.__container__[ContainerRegistrationKeys.PG_CONNECTION] as Knex;
  }

  get reportingCurrency(): string {
    return this.options.reportingCurrency;
  }

  get segments(): SegmentDefinition[] {
    return this.options.segments ?? DEFAULT_RFM_OPTIONS.segments;
  }

  get weights(): RfmModuleOptions["weights"] {
    return this.options.weights;
  }

  get winsorizePercentile(): number {
    return this.options.winsorizePercentile;
  }

  get configuration(): RfmModuleOptions {
    return { ...this.options };
  }

  computeScores(
    records: RawMetricRecord[],
    overrides: Partial<RfmModuleOptions> = {}
  ): ComputeResult {
    return computeRfmScores(records, {
      ...this.options,
      ...overrides
    });
  }

  prepareScoreRows(
    records: RawMetricRecord[],
    overrides: Partial<RfmModuleOptions> = {}
  ): ScoreRow[] {
    const { scores } = this.computeScores(records, overrides);
    return scores.map((score) => this.toRow(score));
  }

  toRow(score: ScoredMetricRecord): ScoreRow {
    return {
      customer_id: score.customerId,
      recency_days: score.recencyDays,
      frequency_365d: score.frequency365d,
      monetary_365d_cents: score.monetary365dCents,
      r_score: score.rScore,
      f_score: score.fScore,
      m_score: score.mScore,
      rfm_segment: score.segmentLabel,
      rfm_index: score.rfmIndex,
      calculated_at: score.calculatedAt
    };
  }

  /**
   * Temporary helper exposing the raw database connection. Future steps will
   * replace direct access with dedicated repositories/workflows.
   */
  getDatabase(): Knex {
    return this.db;
  }
}

export default RfmModuleService;
