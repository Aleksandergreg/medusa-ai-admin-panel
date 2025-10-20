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

export function AssistantFeedbackSection() {
  const { responses, loading, error } = useAssistantNpsRecent(6);

  const feedbackRows = useMemo(
    () =>
      responses.filter(
        (row) => !row.metadata.isTurnFeedback && row.metadata.llmFeedback
      ),
    [responses]
  );

  return (
    <div className="rounded-md border bg-ui-bg-base p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Heading level="h2" className="text-base">
          Assistant qualitative feedback
        </Heading>
        <Badge size="small">{feedbackRows.length}</Badge>
      </div>

      <Text size="small" className="text-ui-fg-subtle">
        Highlights the most recent AI operations with LLM-authored feedback.
      </Text>

      {loading && (
        <Text size="small" className="text-ui-fg-subtle">
          Loading qualitative feedback…
        </Text>
      )}

      {error && (
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {feedbackRows.length === 0 ? (
            <Text size="small" className="text-ui-fg-subtle">
              No qualitative feedback captured yet.
            </Text>
          ) : (
            feedbackRows.map((row) => {
              const feedback = row.metadata.llmFeedback!;
              const heuristicNote = row.metadata.feedback;
              return (
                <div key={row.id} className="border-t pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-1">
                      <Text weight="plus" className="text-sm">
                        {row.taskLabel ?? "Unlabeled task"}
                      </Text>
                      <Text size="small" className="text-ui-fg-subtle">
                        {formatDate(row.createdAt)} · Score {row.score}/10
                      </Text>
                      {row.operationId && (
                        <Text size="small" className="text-ui-fg-muted">
                          Operation: {row.operationId}
                        </Text>
                      )}
                    </div>
                    {row.errorFlag && (
                      <StatusBadge color="red">Errors detected</StatusBadge>
                    )}
                  </div>

                  <Text className="mt-2 text-sm leading-relaxed">
                    {feedback.summary}
                  </Text>

                  {feedback.positives.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <Text size="small" weight="plus">
                        What worked
                      </Text>
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {feedback.positives.map((item, index) => (
                          <li key={`${row.id}-pos-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {feedback.suggestions.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <Text size="small" weight="plus">
                        Opportunities
                      </Text>
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {feedback.suggestions.map((item, index) => (
                          <li key={`${row.id}-sug-${index}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {heuristicNote && (
                    <Text size="small" className="mt-2 text-ui-fg-subtle italic">
                      Heuristic note: {heuristicNote}
                    </Text>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
