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

  private async loadQuery(): Promise<any> {
    try {
      return this.__container__.resolve?.(
        ContainerRegistrationKeys.QUERY
      );
    } catch {
      // Query is not available in the container (e.g., CLI context).
      return null;
    }
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

  private findColumn(
    columns: Set<string>,
    candidates: string[],
    fallback?: (name: string) => boolean
  ): string | null {
    for (const candidate of candidates) {
      if (columns.has(candidate)) {
        return candidate;
      }
    }
    if (fallback) {
      for (const column of columns) {
        if (fallback(column)) {
          return column;
        }
      }
    }
    return null;
  }

  private async buildLineItemSource(): Promise<{ unionSql: string | null }> {
    const candidateTables = [
      "order_line_item",
      "order_item",
      "order_items"
    ];

    const selects: string[] = [];

    for (const table of candidateTables) {
      const columns = await this.getTableColumns(table);
      if (!columns.size) {
        continue;
      }

      const orderColumn = this.findColumn(columns, ["order_id"], (name) =>
        name.endsWith("_order_id") || name === "order"
      );
      const unitPriceColumn = this.findColumn(
        columns,
        ["unit_price", "unitprice", "amount", "unit_amount"],
        (name) => name.includes("unit") && name.includes("price")
      );
      const quantityColumn = this.findColumn(
        columns,
        ["quantity", "qty"],
        (name) => name.includes("quantity")
      );

      if (!orderColumn || !unitPriceColumn || !quantityColumn) {
        continue;
      }

      const selectSql = `select
          "${table}"."${orderColumn}" as order_id,
          "${table}"."${unitPriceColumn}" as unit_price,
          "${table}"."${quantityColumn}" as quantity
        from "${table}"`;
      selects.push(selectSql);
    }

    if (!selects.length) {
      return { unionSql: null };
    }

    const unionSql = selects.join("\n        union all\n        ");
    return { unionSql };
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed.length) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private extractOrderMonetary(order: any): number {
    const summary = order?.summary ?? {};
    const monetaryCandidates = [
      summary.current_order_total,
      summary.current_total,
      summary.transaction_total,
      summary.paid_total,
      summary.raw_paid_total,
      summary.total
    ];

    for (const candidate of monetaryCandidates) {
      const parsed = this.toNumber(candidate);
      if (parsed !== null) {
        return Math.round(parsed);
      }
    }

    const items = Array.isArray(order?.items) ? order.items : [];
    const itemSum = items.reduce((acc: number, item: any) => {
      const unit = this.toNumber(item?.unit_price) ?? 0;
      const quantity = Number(item?.quantity ?? 0);
      return acc + unit * quantity;
    }, 0);

    return Math.round(itemSum);
  }

  private extractOrderRefund(order: any): number {
    const summary = order?.summary ?? {};
    const refundCandidates = [
      summary.refunded_total,
      summary.raw_refunded_total,
      summary.return_total
    ];

    for (const candidate of refundCandidates) {
      const parsed = this.toNumber(candidate);
      if (parsed !== null) {
        return Math.round(parsed);
      }
    }

    return 0;
  }

  private async fetchOrdersViaQuery(
    customerId: string,
    windowStart: Date
  ): Promise<any[] | null> {
    const query = await this.loadQuery();
    if (!query) {
      return null;
    }

    const take = 200;
    let skip = 0;
    const orders: any[] = [];

    while (true) {
      const response = await query.graph({
        entity: "order",
        fields: [
          "id",
          "customer_id",
          "created_at",
          "summary.current_order_total",
          "summary.current_total",
          "summary.transaction_total",
          "summary.paid_total",
          "summary.raw_paid_total",
          "summary.refunded_total",
          "summary.raw_refunded_total",
          "items.unit_price",
          "items.quantity"
        ],
        filters: {
          customer_id: customerId
        },
        pagination: {
          skip,
          take
        }
      });

      const batch = Array.isArray(response?.data) ? response.data : [];
      if (!batch.length) {
        break;
      }

      for (const order of batch) {
        const createdAt = order?.created_at ? new Date(order.created_at) : null;
        if (createdAt && createdAt >= windowStart) {
          orders.push(order);
        }
      }

      if (batch.length < take) {
        break;
      }

      skip += take;
    }

    return orders;
  }

  private async fetchOrdersViaSql(
    customerId: string,
    windowStart: Date
  ): Promise<any[]> {
    const { unionSql } = await this.buildLineItemSource();

    if (!unionSql) {
      return [];
    }

    const sql = `
      select
        o.id,
        o.created_at,
        coalesce(sum(li.unit_price * li.quantity * 100), 0) as item_total_cents
      from "order" o
      join (
        ${unionSql}
      ) as li on li.order_id = o.id
      where o.customer_id = :customerId
        and o.created_at >= :windowStart
      group by o.id
    `;

    const results = await this.db.raw(sql, {
      customerId,
      windowStart: windowStart.toISOString()
    });

    return results.rows ?? [];
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

  private async fetchRawMetrics(
    options: RawMetricFetchOptions = {}
  ): Promise<{ windowStart: Date; windowDays: number; records: RawMetricRecord[] }> {
    const { windowStart, windowDays } = this.resolveWindowStart(options);
    const customerIds = Array.isArray(options.customerIds)
      ? options.customerIds.filter((id) => typeof id === "string" && id.trim())
      : [];

    if (!customerIds.length) {
      return { windowStart, windowDays, records: [] };
    }

    const records: RawMetricRecord[] = [];

    for (const customerId of customerIds) {
      const viaQuery = await this.fetchOrdersViaQuery(customerId, windowStart);
      const viaSql =
        viaQuery === null
          ? await this.fetchOrdersViaSql(customerId, windowStart)
          : [];
      const orders = viaQuery ?? viaSql;

      let latestOrderMs: number | null = null;
      let frequency = 0;
      let monetary = 0;

      for (const order of orders) {
        const createdAt = order?.created_at ? new Date(order.created_at) : null;
        if (createdAt) {
          const ms = createdAt.getTime();
          if (!Number.isNaN(ms)) {
            latestOrderMs = latestOrderMs === null ? ms : Math.max(latestOrderMs, ms);
          }
        }

        const orderTotal = viaQuery
          ? this.extractOrderMonetary(order)
          : this.toNumber(order?.item_total_cents) ?? 0;
        const refundTotal = viaQuery
          ? this.extractOrderRefund(order)
          : 0;
        monetary += Math.max(0, orderTotal - refundTotal);
        frequency += 1;
      }

      const recencyDays =
        latestOrderMs === null
          ? null
          : Math.max(0, Math.floor((Date.now() - latestOrderMs) / DAY_IN_MS));

      records.push({
        customerId,
        recencyDays,
        frequency365d: frequency,
        monetary365dCents: monetary
      });
    }

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
