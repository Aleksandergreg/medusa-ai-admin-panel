export type QualitativeFeedback = {
  summary: string;
  positives: string[];
  suggestions: string[];
};

export type FeedbackPayload = {
  ok?: boolean;
  feedback?: string;
  positives?: unknown;
  suggestions?: unknown;
  improvements?: unknown;
};

export const MAX_POSITIVE_ITEMS = 5;
export const MAX_SUGGESTION_ITEMS = 5;
