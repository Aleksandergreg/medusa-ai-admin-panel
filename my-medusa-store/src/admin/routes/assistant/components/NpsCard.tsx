import { Heading, Text } from "@medusajs/ui";
import { useAssistantNpsMetrics } from "../hooks/useAssistantNpsMetrics";

const formatNps = (value: number | null | undefined): string => {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(1);
};

export function NpsCard() {
  const { metrics, loading, error } = useAssistantNpsMetrics();
  const last30 = metrics?.last30Days;
  const hasData = (last30?.responses ?? 0) > 0;

  return (
    <div className="rounded-md border bg-ui-bg-base p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Heading level="h2" className="text-base">
          NPS last 30 days
        </Heading>
        <span className="text-2xl font-semibold">
          {formatNps(last30?.nps)}
        </span>
      </div>
      <Text size="small" className="text-ui-fg-subtle">
        {hasData
          ? `${last30?.responses ?? 0} response${
              (last30?.responses ?? 0) === 1 ? "" : "s"
            }`
          : "No responses yet"}
      </Text>

      {loading && (
        <Text size="small" className="text-ui-fg-subtle">
          Loading metrics…
        </Text>
      )}

      {error && (
        <Text size="small" className="text-ui-fg-error">
          {error}
        </Text>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          <Heading level="h3" className="text-sm font-medium">
            NPS by task
          </Heading>
          {metrics && metrics.byTask.length > 0 ? (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-ui-bg-subtle text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Task</th>
                    <th className="px-3 py-2 font-medium">NPS</th>
                    <th className="px-3 py-2 font-medium">Responses</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byTask.map((row) => (
                    <tr
                      key={`${row.taskLabel ?? "unknown"}-${row.responses}`}
                      className="border-t"
                    >
                      <td className="px-3 py-2">
                        {row.taskLabel ?? "Unlabeled"}
                      </td>
                      <td className="px-3 py-2">{formatNps(row.nps)}</td>
                      <td className="px-3 py-2">{row.responses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              No task-level data for the last 30 days.
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
