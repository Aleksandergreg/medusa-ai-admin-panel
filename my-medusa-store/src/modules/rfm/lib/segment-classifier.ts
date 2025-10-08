import { SegmentCondition, SegmentDefinition } from "../config";
import { SegmentEvaluationContext, SegmentMatch } from "./types";

const DEFAULT_SEGMENT: SegmentDefinition = {
  id: "unclassified",
  label: "Unclassified",
  priority: 999,
  fallback: true
};

function getContextValue(
  context: SegmentEvaluationContext,
  field: SegmentCondition["field"]
): number | null {
  switch (field) {
    case "r_score":
      return context.rScore;
    case "f_score":
      return context.fScore;
    case "m_score":
      return context.mScore;
    case "recency_days":
      return context.recencyDays;
    case "frequency_365d":
      return context.frequency365d;
    case "monetary_365d_cents":
      return context.monetary365dCents;
    default:
      return null;
  }
}

function evaluateCondition(
  condition: SegmentCondition,
  context: SegmentEvaluationContext
): boolean {
  const value = getContextValue(context, condition.field);

  switch (condition.operator) {
    case "is_null":
      return value === null || value === undefined;
    case "not_null":
      return value !== null && value !== undefined;
    case "eq":
      if (value === null || value === undefined) {
        return false;
      }
      return value === condition.value;
    case "gte":
      if (value === null || value === undefined) {
        return false;
      }
      return value >= (condition.value as number);
    case "gt":
      if (value === null || value === undefined) {
        return false;
      }
      return value > (condition.value as number);
    case "lte":
      if (value === null || value === undefined) {
        return false;
      }
      return value <= (condition.value as number);
    case "lt":
      if (value === null || value === undefined) {
        return false;
      }
      return value < (condition.value as number);
    case "between":
      if (value === null || value === undefined) {
        return false;
      }
      if (!Array.isArray(condition.value) || condition.value.length !== 2) {
        return false;
      }
      return value >= condition.value[0] && value <= condition.value[1];
    default:
      return false;
  }
}

function matchesSegment(
  definition: SegmentDefinition,
  context: SegmentEvaluationContext
): boolean {
  const all =
    definition.all?.every((condition) =>
      evaluateCondition(condition, context)
    ) ?? true;

  if (!all) {
    return false;
  }

  const any =
    definition.any === undefined
      ? true
      : definition.any.length === 0
      ? false
      : definition.any.some((condition) =>
          evaluateCondition(condition, context)
        );

  if (!any) {
    return false;
  }

  const none =
    definition.none?.some((condition) =>
      evaluateCondition(condition, context)
    ) ?? false;

  return !none;
}

export function classifySegment(
  context: SegmentEvaluationContext,
  definitions: SegmentDefinition[]
): SegmentMatch {
  let fallback: SegmentDefinition | undefined;

  for (const definition of definitions) {
    if (definition.fallback) {
      fallback = definition;
    }

    if (matchesSegment(definition, context)) {
      return {
        id: definition.id,
        label: definition.label,
        definition
      };
    }
  }

  const resolvedFallback =
    fallback ?? definitions[definitions.length - 1] ?? DEFAULT_SEGMENT;

  return {
    id: resolvedFallback.id,
    label: resolvedFallback.label,
    definition: resolvedFallback
  };
}
