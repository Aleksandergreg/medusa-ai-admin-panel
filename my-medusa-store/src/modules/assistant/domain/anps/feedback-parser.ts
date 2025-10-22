import { safeParseJSON } from "../../lib/utils";
import {
  FeedbackPayload,
  MAX_POSITIVE_ITEMS,
  MAX_SUGGESTION_ITEMS,
  QualitativeFeedback,
} from "./feedback-models";
import { normalizeFeedbackItems } from "./feedback-formatting";

export const parseFeedbackPayload = (
  raw: string
): FeedbackPayload | null => {
  if (!raw.trim()) {
    return null;
  }

  const parsed = safeParseJSON<FeedbackPayload>(raw.trim());
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed;
};

export const toQualitativeFeedback = (
  payload: FeedbackPayload
): QualitativeFeedback | null => {
  const summary =
    typeof payload.feedback === "string" && payload.feedback.trim()
      ? payload.feedback.trim()
      : null;

  if (!summary) {
    return null;
  }

  const positives = normalizeFeedbackItems(
    payload.positives,
    MAX_POSITIVE_ITEMS
  );

  let suggestions = normalizeFeedbackItems(
    payload.suggestions,
    MAX_SUGGESTION_ITEMS
  );

  if (!suggestions.length) {
    suggestions = normalizeFeedbackItems(
      payload.improvements,
      MAX_SUGGESTION_ITEMS
    );
  }

  return {
    summary,
    positives,
    suggestions,
  };
};
