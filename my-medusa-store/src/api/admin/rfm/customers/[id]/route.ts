import type {
  AuthenticatedMedusaRequest,
  MedusaResponse
} from "@medusajs/framework/http";
import { z } from "zod";
import RfmModuleService from "../../../../../modules/rfm/service";
import { RFM_MODULE } from "../../../../../modules/rfm";

const paramsSchema = z.object({
  id: z.string().min(1)
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
  const parsedParams = paramsSchema.safeParse(req.params);

  if (!parsedParams.success) {
    return res.status(400).json({
      error: "Invalid customer id",
      details: parsedParams.error.flatten()
    });
  }

  const service = req.scope.resolve<RfmModuleService>(RFM_MODULE);
  const db = service.getDatabase();

  const row = await db<ScoreRow>("rfm_scores")
    .where("customer_id", parsedParams.data.id)
    .first();

  if (!row) {
    return res.status(404).json({ error: "Not found" });
  }

  return res.json(mapRow(row));
}
