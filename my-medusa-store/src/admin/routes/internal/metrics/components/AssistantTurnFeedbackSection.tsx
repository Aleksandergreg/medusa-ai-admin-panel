import { useMemo } from "react";
import { Heading, Text, Badge, StatusBadge } from "@medusajs/ui";
import { useAssistantNpsRecent } from "../../../assistant/hooks/useAssistantNpsRecent";

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

export function AssistantTurnFeedbackSection() {
  const { responses, loading, error } = useAssistantNpsRecent(6);

  const turnRows = useMemo(
    () =>
      responses.filter(
        (row) => row.metadata.isTurnFeedback && row.metadata.llmFeedback
      ),
    [responses]
  );

  return (
    <div className="rounded-md border bg-ui-bg-base p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Heading level="h2" className="text-base">
          Assistant turn feedback
        </Heading>
        <Badge size="small">{turnRows.length}</Badge>
      </div>

      <Text size="small" className="text-ui-fg-subtle">
        Aggregated review of entire assistant turns, summarizing multi-step plans and tool usage.
      </Text>

      {loading && (
        <Text size="small" className="text-ui-fg-subtle">
          Loading turn-level feedback…
        </Text>
      )}

      {error && (
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {turnRows.length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">
              No turn-level feedback captured yet.
            </Text>
          ) : (
            turnRows.map((row) => {
              const feedback = row.metadata.llmFeedback!;
              const aggregate = row.metadata.aggregate;
              return (
                <div key={row.id} className="border-t pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <Text weight="plus" className="text-sm">
                        Turn summary
                      </Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        {formatDate(row.createdAt)} · Avg score {formatScore(aggregate?.averageScore)}
                      </Text>
                    </div>
                    {aggregate?.totalErrors && aggregate.totalErrors > 0 ? (
                      <StatusBadge color="red">
                        {aggregate.totalErrors} error{aggregate.totalErrors === 1 ? "" : "s"}
                      </StatusBadge>
                    ) : (
                      <StatusBadge color="green">No errors</StatusBadge>
                    )}
                  </div>

                  <Text className="mt-2 text-sm leading-relaxed">
                    {feedback.summary}
                  </Text>

                  {feedback.positives.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <Text size="small" weight="plus">
                        Highlights
                      </Text>
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {feedback.positives.map((item, index) => (
                          <li key={`${row.id}-turn-pos-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {feedback.suggestions.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <Text size="small" weight="plus">
                        Improvements
                      </Text>
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {feedback.suggestions.map((item, index) => (
                          <li key={`${row.id}-turn-sug-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-3 space-y-2">
                    <Text size="small" weight="plus">
                      Operations covered
                    </Text>
                    {row.metadata.operations.length === 0 ? (
                      <Text size="small" className="text-ui-fg-subtle">
                        No operation breakdown available.
                      </Text>
                    ) : (
                      <div className="space-y-2">
                        {row.metadata.operations.map((op, index) => {
                          const label = op.taskLabel ?? op.operationId;
                          const duration =
                            typeof op.durationMs === "number" && op.durationMs > 0
                              ? `${(op.durationMs / 1000).toFixed(1)}s`
                              : "n/a";
                          return (
                            <div key={`${row.id}-op-${index}`} className="rounded-md border px-3 py-2">
                              <div className="flex flex-wrap justify-between gap-2 text-sm">
                                <Text weight="plus">{label}</Text>
                                <Text className="text-ui-fg-subtle">
                                  Score {op.score ?? "—"}/10 · Attempts {op.attempts ?? "—"} · Errors {op.errors ?? "—"}
                                </Text>
                              </div>
                              <Text size="small" className="text-ui-fg-subtle">
                                Duration {duration} · Last status {op.lastStatusCode ?? "—"}
                              </Text>
                              {op.errorSummary && (
                                <Text size="small" className="text-ui-fg-error mt-1">
                                  {op.errorSummary}
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
      )}
    </div>
  );
}
