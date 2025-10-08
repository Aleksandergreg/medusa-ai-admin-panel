import type {
  AuthenticatedMedusaRequest,
  MedusaResponse
} from "@medusajs/framework/http";
import { z } from "zod";
import RfmModuleService from "../../../../modules/rfm/service";
import { RFM_MODULE } from "../../../../modules/rfm";

const querySchema = z.object({
  limit: z
    .preprocess((value) => (value === undefined ? undefined : Number(value)), z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(50)),
  offset: z
    .preprocess((value) => (value === undefined ? undefined : Number(value)), z
      .number()
      .int()
      .min(0)
      .default(0)),
  segment: z
    .array(z.string())
    .or(z.string())
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  min_index: z
    .preprocess((value) => (value === undefined ? undefined : Number(value)), z
      .number()
      .min(0)
      .max(100))
    .optional(),
  max_recency_days: z
    .preprocess((value) => (value === undefined ? undefined : Number(value)), z
      .number()
      .int()
      .min(0))
    .optional(),
  customer_id: z.string().optional()
});

type ScoreRow = {
  customer_id: string;
  recency_days: number | null;
  frequency_365d: number;
  monetary_365d_cents: string | number;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_segment: string;
  rfm_index: number;
  calculated_at: Date | string;
};

type ListQuery = z.infer<typeof querySchema>;

function normalizeMonetary(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function serializeTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function mapRow(row: ScoreRow) {
  return {
    customer_id: row.customer_id,
    recency_days: row.recency_days,
    frequency_365d: row.frequency_365d,
    monetary_365d_cents: normalizeMonetary(row.monetary_365d_cents),
    r_score: row.r_score,
    f_score: row.f_score,
    m_score: row.m_score,
    rfm_segment: row.rfm_segment,
    rfm_index: row.rfm_index,
    calculated_at: serializeTimestamp(row.calculated_at)
  };
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const parsed = querySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query parameters",
      details: parsed.error.flatten()
    });
  }

  const query = parsed.data as ListQuery;
  const service = req.scope.resolve<RfmModuleService>(RFM_MODULE);
  const db = service.getDatabase();
  const builder = db<ScoreRow>("rfm_scores");

  if (query.segment?.length) {
    builder.whereIn("rfm_segment", query.segment);
  }

  if (typeof query.min_index === "number") {
    builder.where("rfm_index", ">=", query.min_index);
  }

  if (typeof query.max_recency_days === "number") {
    builder.where("recency_days", "<=", query.max_recency_days);
  }

  if (query.customer_id) {
    builder.where("customer_id", query.customer_id);
  }

  const [{ count }] = await builder
    .clone()
    .count<{ count: string | number }>({ count: "*" });

  const rows = await builder
    .clone()
    .orderBy("rfm_index", "desc")
    .orderBy("recency_days", "asc")
    .offset(query.offset)
    .limit(query.limit);

  return res.json({
    count: Number(count ?? 0),
    offset: query.offset,
    limit: query.limit,
    data: rows.map(mapRow)
  });
}
