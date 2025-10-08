import {
  DEFAULT_RFM_OPTIONS,
  DEFAULT_SEGMENTS,
  RfmModuleOptions
} from "../config";
import { classifySegment } from "./segment-classifier";
import {
  QuintileDistribution,
  RawMetricRecord,
  ScoredMetricRecord,
  WinsorizedMetric
} from "./types";

type QuintileMap = Map<string, number>;

export type ComputeResult = {
  scores: ScoredMetricRecord[];
  distributions: QuintileDistribution;
};

type MetricKind = "recency" | "frequency" | "monetary";

const QUINTILE_PERCENTS = [0.2, 0.4, 0.6, 0.8, 1];

function cloneOptions(options: Partial<RfmModuleOptions>): RfmModuleOptions {
  const defaults = DEFAULT_RFM_OPTIONS;
  return {
    ...defaults,
    ...options,
    weights: {
      ...defaults.weights,
      ...(options.weights ?? {})
    },
    segments: options.segments ?? DEFAULT_SEGMENTS
  };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0;
  }
  if (p <= 0) {
    return sorted[0];
  }
  if (p >= 1) {
    return sorted[sorted.length - 1];
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function winsorize(
  entries: WinsorizedMetric[],
  percentileCutoff: number
): WinsorizedMetric[] {
  if (!entries.length) {
    return [];
  }
  const p = Math.max(0.5, Math.min(percentileCutoff, 0.999));
  const lowerTail = 1 - p;
  const sortedValues = entries
    .map((entry) => entry.value)
    .sort((a, b) => a - b);
  const lowerBound = percentile(sortedValues, lowerTail);
  const upperBound = percentile(sortedValues, p);
  return entries.map((entry) => ({
    customerId: entry.customerId,
    value: Math.min(upperBound, Math.max(lowerBound, entry.value))
  }));
}

function assignQuintiles(
  entries: WinsorizedMetric[],
  invert: boolean
): QuintileMap {
  if (!entries.length) {
    return new Map();
  }

  const sorted = entries
    .slice()
    .sort((a, b) =>
      invert ? a.value - b.value : b.value - a.value
    );

  const map = new Map<string, number>();
  const n = sorted.length;

  for (let i = 0; i < n; i += 1) {
    const tileIndex = Math.floor((i * 5) / n);
    const score = Math.max(1, Math.min(5, 5 - tileIndex));
    map.set(sorted[i].customerId, score);
  }

  return map;
}

function buildDistribution(entries: WinsorizedMetric[]): number[] {
  if (!entries.length) {
    return [];
  }
  const sorted = entries
    .map((entry) => entry.value)
    .sort((a, b) => a - b);
  return QUINTILE_PERCENTS.map((p) => percentile(sorted, p));
}

function extractMetric(
  records: RawMetricRecord[],
  kind: MetricKind
): WinsorizedMetric[] {
  switch (kind) {
    case "recency":
      return records
        .filter((record) => record.recencyDays !== null)
        .map((record) => ({
          customerId: record.customerId,
          value: record.recencyDays as number
        }));
    case "frequency":
      return records.map((record) => ({
        customerId: record.customerId,
        value: record.frequency365d
      }));
    case "monetary":
      return records.map((record) => ({
        customerId: record.customerId,
        value: record.monetary365dCents
      }));
    default:
      return [];
  }
}

function computeIndex(
  scores: { rScore: number; fScore: number; mScore: number },
  weights: RfmModuleOptions["weights"]
): number {
  const { recency, frequency, monetary } = weights;
  const weightSum = recency + frequency + monetary;
  if (weightSum <= 0) {
    return 0;
  }

  const normalized = {
    recency: recency / weightSum,
    frequency: frequency / weightSum,
    monetary: monetary / weightSum
  };

  const raw =
    scores.rScore * normalized.recency +
    scores.fScore * normalized.frequency +
    scores.mScore * normalized.monetary;

  return Math.round((raw / 5) * 100);
}

export function computeRfmScores(
  records: RawMetricRecord[],
  options: Partial<RfmModuleOptions> = {}
): ComputeResult {
  const config = cloneOptions(options);
  const { winsorizePercentile, weights, segments = DEFAULT_SEGMENTS } = config;

  const recencyMetrics = winsorize(
    extractMetric(records, "recency"),
    winsorizePercentile
  );
  const frequencyMetrics = winsorize(
    extractMetric(records, "frequency"),
    winsorizePercentile
  );
  const monetaryMetrics = winsorize(
    extractMetric(records, "monetary"),
    winsorizePercentile
  );

  const recencyScores = assignQuintiles(recencyMetrics, true);
  const frequencyScores = assignQuintiles(frequencyMetrics, false);
  const monetaryScores = assignQuintiles(monetaryMetrics, false);

  const distributions: QuintileDistribution = {
    recency: buildDistribution(recencyMetrics),
    frequency: buildDistribution(frequencyMetrics),
    monetary: buildDistribution(monetaryMetrics)
  };

  const calculatedAt = new Date();

  const scores: ScoredMetricRecord[] = records.map((record) => {
    const rScore =
      record.recencyDays === null
        ? 1
        : recencyScores.get(record.customerId) ?? 1;
    const fScore = frequencyScores.get(record.customerId) ?? 1;
    const mScore = monetaryScores.get(record.customerId) ?? 1;
    const rfmIndex = computeIndex({ rScore, fScore, mScore }, weights);
    const match = classifySegment(
      {
        customerId: record.customerId,
        recencyDays: record.recencyDays,
        frequency365d: record.frequency365d,
        monetary365dCents: record.monetary365dCents,
        rScore,
        fScore,
        mScore
      },
      segments
    );

    return {
      ...record,
      rScore,
      fScore,
      mScore,
      rfmIndex,
      segmentId: match.id,
      segmentLabel: match.label,
      calculatedAt
    };
  });

  return {
    scores,
    distributions
  };
}
