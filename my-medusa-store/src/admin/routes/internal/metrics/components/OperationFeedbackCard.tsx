import { Text, StatusBadge } from "@medusajs/ui";
import {
  CheckCircleSolid,
  ExclamationCircleSolid,
  Clock,
  InformationCircleSolid,
} from "@medusajs/icons";

import type { AssistantNpsResponseRow } from "../../../assistant/lib/assistantApi";
import { FeedbackMarkdownText } from "./FeedbackMarkdownText";

/**
 * Presentational card for a single operation-level ANPS response.
 * Shared between the overview list and the per-operation drilldown page to
 * keep styling and formatting consistent.
 */
export function OperationFeedbackCard({
  row,
}: {
  row: AssistantNpsResponseRow;
}) {
  const feedback = row.metadata.llmFeedback!;
  const heuristicNote = row.metadata.feedback;
  const score = row.score;

  return (
    <div className="rounded-lg border bg-ui-bg-base p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Header section with task name, timestamp, operation id, and score badge */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <Text weight="plus" className="text-base mb-2">
            {row.taskLabel ?? "Unlabeled Operation"}
          </Text>
          <div className="flex items-center gap-3 text-ui-fg-subtle">
            <div className="flex items-center gap-1.5">
              <Clock className="text-ui-fg-muted" />
              <Text size="small">{formatOperationDate(row.createdAt)}</Text>
            </div>
            {row.operationId && (
              <div className="flex items-center gap-1.5">
                <InformationCircleSolid className="text-ui-fg-muted" />
                <Text size="small" className="font-mono">
                  {row.operationId}
                </Text>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`rounded-md border px-3 py-1.5 ${getScoreBgColor(
              score
            )}`}
          >
            <div className="flex items-center gap-1.5">
              <Text weight="plus" className={`text-lg ${getScoreColor(score)}`}>
                {score}
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                /10
              </Text>
            </div>
          </div>
          {row.errorFlag && (
            <StatusBadge color="red">
              <ExclamationCircleSolid className="mr-1" />
              Errors
            </StatusBadge>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="mb-4 rounded-md bg-ui-bg-subtle p-3">
        <Text className="text-sm leading-relaxed">{feedback.summary}</Text>
      </div>

      {/* Feedback Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {feedback.positives.length > 0 && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircleSolid className="text-green-600" />
              <Text size="small" weight="plus" className="text-green-900">
                What Worked
              </Text>
            </div>
            <ul className="space-y-1.5 text-sm text-green-900">
              {feedback.positives.map((item, index) => (
                <li key={`${row.id}-pos-${index}`} className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <FeedbackMarkdownText
                    content={item}
                    className="flex-1 text-sm text-green-900 leading-relaxed"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {feedback.suggestions.length > 0 && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <ExclamationCircleSolid className="text-blue-600" />
              <Text size="small" weight="plus" className="text-blue-900">
                Opportunities
              </Text>
            </div>
            <ul className="space-y-1.5 text-sm text-blue-900">
              {feedback.suggestions.map((item, index) => (
                <li key={`${row.id}-sug-${index}`} className="flex items-start gap-2">
                  <span className="text-blue-600 mt-0.5">→</span>
                  <FeedbackMarkdownText
                    content={item}
                    className="flex-1 text-sm text-blue-900 leading-relaxed"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Heuristic Note */}
      {heuristicNote && (
        <div className="mt-4 rounded-md border border-purple-200 bg-purple-50 p-3">
          <div className="flex items-start gap-2">
            <InformationCircleSolid className="text-purple-600 flex-shrink-0 mt-0.5" />
            <div>
              <Text size="small" weight="plus" className="text-purple-900 mb-1">
                Heuristic Analysis
              </Text>
              <Text size="small" className="text-purple-900">
                {heuristicNote}
              </Text>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const formatOperationDate = (date: Date): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

export const getScoreColor = (score: number): string => {
  if (score >= 7) return "text-green-600";
  if (score >= 5) return "text-yellow-600";
  return "text-red-600";
};

export const getScoreBgColor = (score: number): string => {
  if (score >= 7) return "bg-green-100 border-green-300";
  if (score >= 5) return "bg-yellow-100 border-yellow-300";
  return "bg-red-100 border-red-300";
};
