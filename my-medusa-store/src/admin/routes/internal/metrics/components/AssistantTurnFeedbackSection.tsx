import { useMemo } from "react";
import { Text, Badge, StatusBadge } from "@medusajs/ui";
import { useAssistantNpsRecent } from "../../../assistant/hooks/useAssistantNpsRecent";
import {
  CheckCircleSolid,
  ExclamationCircleSolid,
  Clock,
} from "@medusajs/icons";
import { FeedbackMarkdownText } from "./FeedbackMarkdownText";

const formatDate = (date: Date): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
};

const formatScore = (value: number | undefined): string => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(1);
};

const getScoreColor = (score: number | undefined): string => {
  if (typeof score !== "number" || Number.isNaN(score))
    return "text-ui-fg-subtle";
  if (score >= 7) return "text-green-600";
  if (score >= 5) return "text-yellow-600";
  return "text-red-600";
};

const formatDuration = (durationMs?: number | null): string => {
  if (typeof durationMs !== "number" || durationMs <= 0 || Number.isNaN(durationMs)) {
    return "n/a";
  }
  if (durationMs < 1) {
    return "<1ms";
  }
  if (durationMs < 1_000) {
    return `${Math.max(1, Math.round(durationMs))}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1_000).toFixed(2)}s`;
  }
  return `${(durationMs / 1_000).toFixed(1)}s`;
};

export function AssistantTurnFeedbackSection() {
  const { responses, loading, error } = useAssistantNpsRecent(6, {
    taskLabel: "turn-summary",
  });
  const turnRows = useMemo(
    () =>
      responses.filter(
        (row) => row.metadata.isTurnFeedback && row.metadata.llmFeedback
      ),
    [responses]
  );

  if (loading) {
    return (
      <div className="rounded-lg border bg-ui-bg-subtle p-8 text-center">
        <Text className="text-ui-fg-subtle">Loading turn summaries...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <Text className="text-red-600">{error}</Text>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {turnRows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-ui-bg-subtle p-8 text-center">
          <Text className="text-ui-fg-subtle">
            No turn-level feedback captured yet.
          </Text>
        </div>
      ) : (
        turnRows.map((row) => {
          const feedback = row.metadata.llmFeedback!;
          const aggregate = row.metadata.aggregate;
          const avgScore = aggregate?.averageScore;
          const hasErrors = aggregate?.totalErrors && aggregate.totalErrors > 0;
          const userPrompt = row.metadata.prompt?.trim();

          return (
            <div
              key={row.id}
              className="rounded-lg border bg-ui-bg-base p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Text weight="plus" className="text-base">
                      Turn Summary
                    </Text>
                    <div
                      className={`flex items-center gap-1 ${getScoreColor(
                        avgScore
                      )}`}
                    >
                      <Text weight="plus" className="text-lg">
                        {formatScore(avgScore)}
                      </Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        /10
                      </Text>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-ui-fg-subtle">
                    <Clock className="text-ui-fg-muted" />
                    <Text size="small">{formatDate(row.createdAt)}</Text>
                    {typeof aggregate?.agentComputeMs === "number" &&
                      aggregate.agentComputeMs > 0 && (
                        <>
                          <span aria-hidden="true">•</span>
                          <Text size="small">
                            Total compute {formatDuration(aggregate.agentComputeMs)}
                          </Text>
                        </>
                      )}
                  </div>
                </div>
                {hasErrors ? (
                  <StatusBadge color="red">
                    <ExclamationCircleSolid className="mr-1" />
                    {aggregate.totalErrors} error
                    {aggregate.totalErrors === 1 ? "" : "s"}
                  </StatusBadge>
                ) : (
                  <StatusBadge color="green">
                    <CheckCircleSolid className="mr-1" />
                    No errors
                  </StatusBadge>
                )}
              </div>

              {userPrompt && (
                <div className="mb-4 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                  <Text
                    size="xsmall"
                    className="text-ui-fg-subtle uppercase tracking-wide mb-1"
                  >
                    Prompt
                  </Text>
                  <Text className="text-sm leading-relaxed text-ui-fg-base whitespace-pre-line">
                    {userPrompt}
                  </Text>
                </div>
              )}

              {/* Summary */}
              <div className="mb-4 rounded-md bg-ui-bg-subtle p-3">
                <Text className="text-sm leading-relaxed">
                  {feedback.summary}
                </Text>
              </div>

              {/* Highlights & Improvements Grid */}
              <div className="grid gap-4 md:grid-cols-2 mb-4">
                {feedback.positives.length > 0 && (
                  <div className="rounded-md border border-green-200 bg-green-50 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircleSolid className="text-green-600" />
                      <Text
                        size="small"
                        weight="plus"
                        className="text-green-900"
                      >
                        Highlights
                      </Text>
                    </div>
                    <ul className="space-y-1.5 text-sm text-green-900">
                      {feedback.positives.map((item, index) => (
                        <li
                          key={`${row.id}-turn-pos-${index}`}
                          className="flex items-start gap-2"
                        >
                          <span className="text-green-600 mt-0.5">•</span>
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
                      <Text
                        size="small"
                        weight="plus"
                        className="text-blue-900"
                      >
                        Improvements
                      </Text>
                    </div>
                    <ul className="space-y-1.5 text-sm text-blue-900">
                      {feedback.suggestions.map((item, index) => (
                        <li
                          key={`${row.id}-turn-sug-${index}`}
                          className="flex items-start gap-2"
                        >
                          <span className="text-blue-600 mt-0.5">•</span>
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

              {/* Operations */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <Text
                    size="small"
                    weight="plus"
                    className="text-ui-fg-subtle uppercase tracking-wide"
                  >
                    Operations Breakdown
                  </Text>
                  <Badge size="small" color="grey">
                    {row.metadata.operations.length}
                  </Badge>
                </div>
                {row.metadata.operations.length === 0 ? (
                  <Text size="small" className="text-ui-fg-subtle">
                    No operation breakdown available.
                  </Text>
                ) : (
                  <div className="space-y-2">
                    {row.metadata.operations.map((op, index) => {
                      const label = op.taskLabel ?? op.operationId;
                      const duration = formatDuration(op.durationMs);
                      const opScore = op.score;
                      return (
                        <div
                          key={`${row.id}-op-${index}`}
                          className="rounded-md border bg-ui-bg-subtle px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <Text weight="plus" className="text-sm flex-1">
                              {label}
                            </Text>
                            <div
                              className={`text-sm font-semibold ${getScoreColor(
                                opScore
                              )}`}
                            >
                              {opScore ?? "—"}/10
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ui-fg-subtle">
                            <span>⏱️ {duration}</span>
                            <span>
                              🔄 {op.attempts ?? "—"} attempt
                              {op.attempts === 1 ? "" : "s"}
                            </span>
                            <span>
                              ❌ {op.errors ?? "—"} error
                              {op.errors === 1 ? "" : "s"}
                            </span>
                            <span>📊 Status {op.lastStatusCode ?? "—"}</span>
                          </div>
                          {op.errorSummary && (
                            <Text
                              size="small"
                              className="text-red-600 mt-2 font-medium"
                            >
                              ⚠️ {op.errorSummary}
                            </Text>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
