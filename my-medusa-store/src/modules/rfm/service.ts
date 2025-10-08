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
import {
  computeRfmScores,
  ComputeResult
} from "./lib/metrics-calculator";
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

const DEFAULT_WINDOW_DAYS = 365;
const DEFAULT_CHUNK_SIZE = 500;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type RawMetricFetchOptions = {
  customerIds?: string[];
  windowDays?: number;
  windowStart?: Date;
};

export type RecomputeOptions = RawMetricFetchOptions & {
  overrides?: Partial<RfmModuleOptions>;
};

export type RecomputeSummary = {
  processed: number;
  upserted: number;
  windowStart: string;
  windowDays: number;
};

class RfmModuleService extends MedusaService({}) {
  private readonly options: RfmModuleOptions;
  private readonly columnCache = new Map<string, Set<string>>();

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

  private async getTableColumns(tableName: string): Promise<Set<string>> {
    const normalized = tableName.toLowerCase();
    const cached = this.columnCache.get(normalized);
    if (cached) {
      return cached;
    }

    const rows = await this.db
      .select("column_name")
      .from("information_schema.columns")
      .where({
        table_name: normalized
      });

    const columns = new Set(
      rows.map((row: { column_name: string }) =>
        String(row.column_name).toLowerCase()
      )
    );

    this.columnCache.set(normalized, columns);
    return columns;
  }

  private async resolveOrderSummaryMeta(): Promise<
    | {
        joinClause: string;
        paidExpr: (fallback: string) => string;
        refundedExpr: string;
      }
    | null
  > {
    const columns = await this.getTableColumns("order_summary");
    if (!columns.size) {
      return null;
    }

    const paidCandidate = [
      "current_order_total",
      "paid_total",
      "transaction_total",
      "raw_paid_total"
    ].find((column) => columns.has(column));

    const refundedCandidate = [
      "refunded_total",
      "raw_refunded_total"
    ].find((column) => columns.has(column));

    const joinClause =
      paidCandidate || refundedCandidate
        ? 'left join "order_summary" os on os.order_id = o.id'
        : "";

    const paidExpr = (fallback: string) =>
      paidCandidate
        ? `coalesce(os."${paidCandidate}", ${fallback})`
        : fallback;

    const refundedExpr = refundedCandidate
      ? `coalesce(os."${refundedCandidate}", 0)::bigint`
      : "0::bigint";

    return {
      joinClause,
      paidExpr,
      refundedExpr
    };
  }

  private async resolveOrderLineItemMeta(): Promise<
    | {
        cte: string;
        joinClause: string;
        fallbackExpr: string;
      }
    | null
  > {
    const candidateTables = [
      "order_line_item",
      "order_item",
      "order_items"
    ];

    for (const table of candidateTables) {
      const columns = await this.getTableColumns(table);
      if (!columns.size) {
        continue;
      }

      const orderColumn = ["order_id", "order", "orderid"].find((column) =>
        columns.has(column)
      );
      const unitPriceColumn = [
        "unit_price",
        "unitprice",
        "amount"
      ].find((column) => columns.has(column));
      const quantityColumn = ["quantity", "qty"].find((column) =>
        columns.has(column)
      );

      if (!orderColumn || !unitPriceColumn || !quantityColumn) {
        continue;
      }

      const quotedTable = `"${table}"`;
      const cte = `item_totals as (
        select
          oli."${orderColumn}" as order_id,
          sum(coalesce(oli."${unitPriceColumn}", 0) * coalesce(oli."${quantityColumn}", 0)) as item_total_cents
        from ${quotedTable} oli
        group by oli."${orderColumn}"
      )`;

      return {
        cte,
        joinClause: "left join item_totals it on it.order_id = o.id",
        fallbackExpr: "coalesce(it.item_total_cents, 0)"
      };
    }

    return null;
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
    const clone = (segments?: SegmentDefinition[]) =>
      segments?.map((segment) => ({
        ...segment,
        all: segment.all?.map((condition) => ({ ...condition })),
        any: segment.any?.map((condition) => ({ ...condition })),
        none: segment.none?.map((condition) => ({ ...condition }))
      }));

    return {
      ...this.options,
      segments: clone(this.options.segments)
    };
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

  private resolveWindowStart(
    options?: Pick<RecomputeOptions, "windowDays" | "windowStart">
  ): { windowStart: Date; windowDays: number } {
    if (options?.windowStart) {
      const windowDays =
        options.windowDays ??
        Math.max(
          1,
          Math.round(
            (Date.now() - options.windowStart.getTime()) / DAY_IN_MS
          )
        );
      return {
        windowStart: options.windowStart,
        windowDays
      };
    }

    const windowDays = options?.windowDays ?? DEFAULT_WINDOW_DAYS;
    const windowStart = new Date(Date.now() - windowDays * DAY_IN_MS);
    return { windowStart, windowDays };
  }

  private toRawMetricRecord(row: Record<string, unknown>): RawMetricRecord {
    const parseNumber = (value: unknown): number => {
      if (value === null || value === undefined) {
        return 0;
      }
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
      }
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    return {
      customerId: String(row.customer_id),
      recencyDays:
        row.recency_days === null || row.recency_days === undefined
          ? null
          : parseNumber(row.recency_days),
      frequency365d: parseNumber(row.frequency_365d),
      monetary365dCents: parseNumber(row.monetary_365d_cents)
    };
  }

  private async fetchRawMetrics(
    options: RawMetricFetchOptions = {}
  ): Promise<{ windowStart: Date; windowDays: number; records: RawMetricRecord[] }> {
    const { windowStart, windowDays } = this.resolveWindowStart(options);
    const customerIds = Array.isArray(options.customerIds)
      ? options.customerIds.filter((id) => typeof id === "string" && id.trim())
      : undefined;

    const bindings: Record<string, unknown> = {
      window_start: windowStart.toISOString()
    };

    const customerFilter =
      customerIds && customerIds.length
        ? "where id = any(:customer_ids)"
        : "";

    const orderFilter =
      customerIds && customerIds.length
        ? "and o.customer_id = any(:customer_ids)"
        : "";

    if (customerIds && customerIds.length) {
      bindings.customer_ids = customerIds;
    }

    const summaryMeta = await this.resolveOrderSummaryMeta();
    const lineItemMeta = await this.resolveOrderLineItemMeta();

    const ctes = [
      `target_customers as (
        select id
        from customer
        ${customerFilter}
      )`,
      lineItemMeta?.cte ?? null,
      `completed_orders as (
        select
          o.customer_id,
          o.created_at,
          o.currency_code,
          ${(() => {
            const base = lineItemMeta?.fallbackExpr
              ? `${lineItemMeta.fallbackExpr}`
              : "0";
            const withSummary = summaryMeta?.paidExpr
              ? summaryMeta.paidExpr(base)
              : base;
            return `${withSummary}::bigint`;
          })()} as paid_total_cents,
          ${summaryMeta?.refundedExpr ?? "0::bigint"} as refunded_total_cents
        from "order" o
        ${lineItemMeta?.joinClause ?? ""}
        ${summaryMeta?.joinClause ?? ""}
        where o.customer_id is not null
          ${orderFilter}
      )`,
      `last_order as (
        select
          customer_id,
          max(created_at) as last_completed_at
        from completed_orders
        group by customer_id
      )`,
      `window_orders as (
        select
          customer_id,
          created_at,
          paid_total_cents,
          refunded_total_cents,
          (paid_total_cents - refunded_total_cents) as net_total_cents
        from completed_orders
        where created_at >= :window_start
      )`,
      `frequency as (
        select
          customer_id,
          count(*) as order_count
        from window_orders
        group by customer_id
      )`,
      `monetary as (
        select
          customer_id,
          coalesce(sum(net_total_cents), 0) as net_total_cents
        from window_orders
        group by customer_id
      )`
    ].filter(Boolean) as string[];

    const sql = `
      with ${ctes.join(",\n")} 
      select
        c.id as customer_id,
        case
          when l.last_completed_at is null then null
          else extract(day from (now() - l.last_completed_at))::int
        end as recency_days,
        coalesce(f.order_count, 0) as frequency_365d,
        coalesce(m.net_total_cents, 0) as monetary_365d_cents
      from target_customers c
      left join last_order l on l.customer_id = c.id
      left join frequency f on f.customer_id = c.id
      left join monetary m on m.customer_id = c.id
      order by c.id asc
    `;

    const raw = await this.db.raw(sql, bindings);
    const rows: Record<string, unknown>[] = raw.rows ?? [];
    const records = rows.map((row) => this.toRawMetricRecord(row));

    return { windowStart, windowDays, records };
  }

  private async upsertScoreRows(
    rows: ScoreRow[],
    trx?: Knex.Transaction
  ): Promise<number> {
    if (!rows.length) {
      return 0;
    }

    const connection = trx ?? this.db;
    await connection("rfm_scores")
      .insert(
        rows.map((row) => ({
          ...row,
          monetary_365d_cents: row.monetary_365d_cents,
          calculated_at: row.calculated_at
        }))
      )
      .onConflict("customer_id")
      .merge([
        "recency_days",
        "frequency_365d",
        "monetary_365d_cents",
        "r_score",
        "f_score",
        "m_score",
        "rfm_segment",
        "rfm_index",
        "calculated_at"
      ]);

    return rows.length;
  }

  private chunkIds(ids: string[], chunkSize: number): string[][] {
    const result: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      result.push(ids.slice(i, i + chunkSize));
    }
    return result;
  }

  async recomputeCustomers(
    customerIds: string[],
    options: RecomputeOptions = {}
  ): Promise<RecomputeSummary> {
    const normalizedIds = customerIds.filter(
      (id) => typeof id === "string" && id.trim()
    );
    if (!normalizedIds.length) {
      const { windowStart, windowDays } = this.resolveWindowStart(options);
      return {
        processed: 0,
        upserted: 0,
        windowStart: windowStart.toISOString(),
        windowDays
      };
    }

    const { windowStart, windowDays, records } = await this.fetchRawMetrics({
      ...options,
      customerIds: normalizedIds
    });

    if (!records.length) {
      return {
        processed: 0,
        upserted: 0,
        windowStart: windowStart.toISOString(),
        windowDays
      };
    }

    const rows = this.prepareScoreRows(records, options.overrides);
    const upserted = await this.upsertScoreRows(rows);

    return {
      processed: records.length,
      upserted,
      windowStart: windowStart.toISOString(),
      windowDays
    };
  }

  async recomputeAll(
    options: RecomputeOptions & { chunkSize?: number } = {}
  ): Promise<RecomputeSummary> {
    const chunkSize = Math.max(
      10,
      options.chunkSize ?? DEFAULT_CHUNK_SIZE
    );

    const customerRows = await this.db("customer").select("id");
    const customerIds = customerRows.map((row) =>
      typeof row.id === "string" ? row.id : String(row.id)
    );

    if (!customerIds.length) {
      const { windowStart, windowDays } = this.resolveWindowStart(options);
      return {
        processed: 0,
        upserted: 0,
        windowStart: windowStart.toISOString(),
        windowDays
      };
    }

    let totalProcessed = 0;
    let totalUpserted = 0;
    let resolvedWindowStart: string | null = null;
    let resolvedWindowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

    for (const batch of this.chunkIds(customerIds, chunkSize)) {
      const summary = await this.recomputeCustomers(batch, options);
      totalProcessed += summary.processed;
      totalUpserted += summary.upserted;
      resolvedWindowStart = summary.windowStart;
      resolvedWindowDays = summary.windowDays;
    }

    return {
      processed: totalProcessed,
      upserted: totalUpserted,
      windowStart: resolvedWindowStart ?? new Date().toISOString(),
      windowDays: resolvedWindowDays
    };
  }
}

export default RfmModuleService;
