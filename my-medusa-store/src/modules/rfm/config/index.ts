import { z } from "zod";
import rawSegments from "./segments.json";

const conditionSchema = z
  .object({
    field: z.enum([
      "r_score",
      "f_score",
      "m_score",
      "recency_days",
      "frequency_365d",
      "monetary_365d_cents"
    ]),
    operator: z.enum([
      "eq",
      "gte",
      "gt",
      "lte",
      "lt",
      "between",
      "is_null",
      "not_null"
    ]),
    value: z.union([z.number(), z.tuple([z.number(), z.number()])]).optional()
  })
  .superRefine((entry, ctx) => {
    const op = entry.operator;
    if (op === "is_null" || op === "not_null") {
      if (entry.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "operator does not accept a value",
          path: ["value"]
        });
      }
      return;
    }

    if (entry.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "operator requires a numeric value",
        path: ["value"]
      });
      return;
    }

    if (op === "between") {
      if (!Array.isArray(entry.value) || entry.value.length !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "between operator expects a tuple of two numbers",
          path: ["value"]
        });
      }
    } else if (Array.isArray(entry.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "operator expects a single numeric value",
        path: ["value"]
      });
    }
  });

const segmentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int(),
  all: z.array(conditionSchema).optional(),
  any: z.array(conditionSchema).optional(),
  none: z.array(conditionSchema).optional(),
  fallback: z.boolean().optional()
});

const segmentsFileSchema = z.object({
  segments: z.array(segmentSchema)
});

export type SegmentCondition = z.infer<typeof conditionSchema>;
export type SegmentDefinition = z.infer<typeof segmentSchema>;

export interface RfmWeights {
  recency: number;
  frequency: number;
  monetary: number;
}

export interface RfmModuleOptions {
  /** Reporting currency code (e.g. usd, eur) used for monetary normalization */
  reportingCurrency: string;
  /** Optional override for segment definitions */
  segments?: SegmentDefinition[];
  /** RFM weights used when computing the composite index */
  weights: RfmWeights;
  /**
   * Winsorization percentile (0-1). Values above this percentile are clamped to the percentile value.
   * Applied symmetrically around the upper tail to prevent extreme outliers from skewing quintiles.
   */
  winsorizePercentile: number;
}

const parsedSegments = segmentsFileSchema.parse(rawSegments);

export const DEFAULT_SEGMENTS: SegmentDefinition[] = parsedSegments.segments
  .slice()
  .sort((a, b) => a.priority - b.priority);

export const DEFAULT_RFM_OPTIONS: RfmModuleOptions = {
  reportingCurrency: "usd",
  segments: DEFAULT_SEGMENTS,
  weights: {
    recency: 0.5,
    frequency: 0.25,
    monetary: 0.25
  },
  winsorizePercentile: 0.99
};
