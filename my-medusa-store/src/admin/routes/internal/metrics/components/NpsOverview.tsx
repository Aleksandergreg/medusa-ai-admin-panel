import { Heading, Text, Badge } from "@medusajs/ui";
import { useAssistantNpsMetrics } from "../../../assistant/hooks/useAssistantNpsMetrics";
import {
  CheckCircleSolid,
  XCircleSolid,
  Minus,
  ExclamationCircle,
} from "@medusajs/icons";

const formatNps = (value: number | null | undefined): string => {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(1);
};

const getNpsColor = (nps: number | null | undefined): string => {
  if (nps == null || Number.isNaN(nps)) return "text-ui-fg-subtle";
  if (nps >= 7) return "text-green-600";
  if (nps >= 5) return "text-yellow-600";
  return "text-red-600";
};

const getNpsIcon = (nps: number | null | undefined) => {
  if (nps == null || Number.isNaN(nps)) return Minus;
  if (nps >= 7) return CheckCircleSolid;
  if (nps >= 5) return ExclamationCircle;
  return XCircleSolid;
};

const getNpsLabel = (nps: number | null | undefined): string => {
  if (nps == null || Number.isNaN(nps)) return "No data";
  if (nps >= 7) return "Excellent";
  if (nps >= 5) return "Good";
  return "Needs improvement";
};

export function NpsOverview() {
  const { metrics, loading, error } = useAssistantNpsMetrics();
  const last30 = metrics?.last30Days;
  const hasData = (last30?.responses ?? 0) > 0;
  const npsValue = last30?.nps;
  const NpsIcon = getNpsIcon(npsValue);

  if (loading) {
    return (
      <div className="rounded-lg border bg-ui-bg-subtle p-8 text-center">
        <Text className="text-ui-fg-subtle">Loading metrics...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <Text className="text-red-600">{error}</Text>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main NPS Score Card */}
      <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-purple-50 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <Text
              size="small"
              className="text-ui-fg-subtle uppercase tracking-wide mb-2"
            >
              NPS Score (Last 30 Days)
            </Text>
            <div className="flex items-end gap-4">
              <div className={`text-5xl font-bold ${getNpsColor(npsValue)}`}>
                {formatNps(npsValue)}
              </div>
              <div className="flex items-center gap-2 pb-2">
                <NpsIcon className={getNpsColor(npsValue)} />
                <Text className={`font-medium ${getNpsColor(npsValue)}`}>
                  {getNpsLabel(npsValue)}
                </Text>
              </div>
            </div>
            <Text size="small" className="text-ui-fg-muted mt-3">
              {hasData
                ? `Based on ${last30?.responses ?? 0} response${
                    (last30?.responses ?? 0) === 1 ? "" : "s"
                  }`
                : "No responses captured yet"}
            </Text>
          </div>
        </div>
      </div>

      {/* Task Breakdown */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <Heading level="h2" className="text-lg">
            Performance by Task
          </Heading>
          {metrics?.byTask && metrics.byTask.length > 0 && (
            <Badge size="small" color="grey">
              {metrics.byTask.length} task
              {metrics.byTask.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {!metrics || metrics.byTask.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-ui-bg-subtle p-8 text-center">
            <Text className="text-ui-fg-subtle">
              No task-level data available for the last 30 days.
            </Text>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {metrics.byTask.map((row, index) => {
              const taskNps = row.nps;
              const TaskIcon = getNpsIcon(taskNps);
              return (
                <div
                  key={`${row.taskLabel ?? "unknown"}-${index}`}
                  className="rounded-lg border bg-ui-bg-base p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <Text weight="plus" className="text-sm flex-1">
                      {row.taskLabel ?? "Unlabeled Task"}
                    </Text>
                    <TaskIcon
                      className={`${getNpsColor(taskNps)} flex-shrink-0`}
                    />
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <Text
                        size="xsmall"
                        className="text-ui-fg-subtle uppercase tracking-wide mb-1"
                      >
                        NPS Score
                      </Text>
                      <div
                        className={`text-2xl font-bold ${getNpsColor(taskNps)}`}
                      >
                        {formatNps(taskNps)}
                      </div>
                    </div>
                    <div className="text-right">
                      <Text
                        size="xsmall"
                        className="text-ui-fg-subtle uppercase tracking-wide mb-1"
                      >
                        Responses
                      </Text>
                      <Text weight="plus" className="text-lg">
                        {row.responses}
                      </Text>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
