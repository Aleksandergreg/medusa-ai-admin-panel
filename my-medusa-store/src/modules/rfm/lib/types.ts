import { SegmentDefinition } from "../config";

export type CustomerId = string;

export type RawMetricRecord = {
  customerId: CustomerId;
  recencyDays: number | null;
  frequency365d: number;
  monetary365dCents: number;
};

export type QuintileScores = {
  rScore: number;
  fScore: number;
  mScore: number;
};

export type ScoredMetricRecord = RawMetricRecord &
  QuintileScores & {
    rfmIndex: number;
    segmentId: string;
    segmentLabel: string;
    calculatedAt: Date;
  };

export type QuintileDistribution = {
  recency: number[];
  frequency: number[];
  monetary: number[];
};

export type SegmentEvaluationContext = RawMetricRecord & QuintileScores;

export type SegmentMatch = {
  id: string;
  label: string;
  definition: SegmentDefinition;
};

export type WinsorizedMetric = {
  customerId: CustomerId;
  value: number;
};
