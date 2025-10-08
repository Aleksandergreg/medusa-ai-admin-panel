import { z } from "zod";

const ScoreSchema = z.object({
  customer_id: z.string(),
  recency_days: z.number().nullable(),
  frequency_365d: z.number(),
  monetary_365d_cents: z.number(),
  r_score: z.number(),
  f_score: z.number(),
  m_score: z.number(),
  rfm_segment: z.string(),
  rfm_index: z.number(),
  calculated_at: z.string()
});

const ListResponseSchema = z.object({
  count: z.number(),
  offset: z.number(),
  limit: z.number(),
  data: z.array(ScoreSchema)
});

const ConditionSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional()
});

const SegmentSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  priority: z.number(),
  all: z.array(ConditionSchema).optional(),
  any: z.array(ConditionSchema).optional(),
  none: z.array(ConditionSchema).optional(),
  fallback: z.boolean().optional()
});

const SegmentsResponseSchema = z.object({
  reporting_currency: z.string(),
  weights: z.object({
    recency: z.number(),
    frequency: z.number(),
    monetary: z.number()
  }),
  winsorize_percentile: z.number(),
  segments: z.array(SegmentSchema)
});

export type RfmScore = z.infer<typeof ScoreSchema>;
export type RfmScoreListResponse = z.infer<typeof ListResponseSchema>;
export type SegmentDefinition = z.infer<typeof SegmentSchema>;
export type RfmConfig = z.infer<typeof SegmentsResponseSchema>;

export type RfmListQuery = {
  limit?: number;
  offset?: number;
  segment?: string | string[];
  min_index?: number;
  max_recency_days?: number;
  customer_id?: string;
};

function buildQuery(params: RfmListQuery = {}): string {
  const search = new URLSearchParams();

  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    search.set("offset", String(params.offset));
  }
  if (params.segment) {
    const segments = Array.isArray(params.segment)
      ? params.segment
      : [params.segment];
    segments.filter(Boolean).forEach((seg) => search.append("segment", seg));
  }
  if (typeof params.min_index === "number") {
    search.set("min_index", String(params.min_index));
  }
  if (typeof params.max_recency_days === "number") {
    search.set("max_recency_days", String(params.max_recency_days));
  }
  if (params.customer_id) {
    search.set("customer_id", params.customer_id);
  }

  const query = search.toString();
  return query.length ? `?${query}` : "";
}

async function handleResponse<T>(
  res: Response,
  schema: z.ZodSchema<T>
): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      json && (json.error || json.message)
        ? String(json.error || json.message)
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server");
  }
  return parsed.data;
}

export async function listRfmScores(
  params: RfmListQuery = {},
  signal?: AbortSignal
): Promise<RfmScoreListResponse> {
  const res = await fetch(`/admin/rfm/customers${buildQuery(params)}`, {
    method: "GET",
    credentials: "include",
    signal
  });
  return handleResponse(res, ListResponseSchema);
}

export async function getRfmScore(
  customerId: string,
  signal?: AbortSignal
): Promise<RfmScore> {
  const res = await fetch(`/admin/rfm/customers/${customerId}`, {
    method: "GET",
    credentials: "include",
    signal
  });
  return handleResponse(res, ScoreSchema);
}

export async function fetchRfmConfig(
  signal?: AbortSignal
): Promise<RfmConfig> {
  const res = await fetch("/admin/rfm/segments", {
    method: "GET",
    credentials: "include",
    signal
  });
  return handleResponse(res, SegmentsResponseSchema);
}
