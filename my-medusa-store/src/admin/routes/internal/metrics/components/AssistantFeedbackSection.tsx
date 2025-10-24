import { useMemo } from "react";
import { Text } from "@medusajs/ui";
import { useAssistantNpsRecent } from "../../../assistant/hooks/useAssistantNpsRecent";
import { OperationFeedbackCard } from "./OperationFeedbackCard";

export function AssistantFeedbackSection() {
  const { responses, loading, error } = useAssistantNpsRecent(6);

  const feedbackRows = useMemo(
    () =>
      responses.filter(
        (row) => !row.metadata.isTurnFeedback && row.metadata.llmFeedback
      ),
    [responses]
  );

  if (loading) {
    return (
      <div className="rounded-lg border bg-ui-bg-subtle p-8 text-center">
        <Text className="text-ui-fg-subtle">Loading operation details...</Text>
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
      {feedbackRows.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-ui-bg-subtle p-8 text-center">
          <Text className="text-ui-fg-subtle">
            No operation-level feedback captured yet.
          </Text>
        </div>
      ) : (
        feedbackRows.map((row) => (
          <OperationFeedbackCard key={row.id} row={row} />
        ))
      )}
    </div>
  );
}
