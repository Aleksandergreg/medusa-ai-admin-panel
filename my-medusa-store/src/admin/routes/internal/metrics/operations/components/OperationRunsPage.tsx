'use client';

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Container, Heading, Text, Badge, Button } from "@medusajs/ui";

import { useAssistantNpsRecent } from "../../../../assistant/hooks/useAssistantNpsRecent";
import type { AssistantNpsResponseRow } from "../../../../assistant/lib/assistantApi";
import {
  OperationFeedbackCard,
  getScoreColor,
} from "../../components/OperationFeedbackCard";

const INITIAL_LIMIT = 50;
const LOAD_INCREMENT = 25;
const MAX_LIMIT = 100;

const formatAverageScore = (value: number | null): string => {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(1);
};

const formatDuration = (durationMs: number | null): string => {
  if (durationMs == null || durationMs <= 0 || Number.isNaN(durationMs)) {
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

const computeSummary = (rows: AssistantNpsResponseRow[]) => {
  if (!rows.length) {
    return {
      totalRuns: 0,
      averageScore: null as number | null,
      errorCount: 0,
      averageDurationMs: null as number | null,
    };
  }

  const totalScore = rows.reduce((sum, row) => sum + row.score, 0);
  const errorCount = rows.reduce(
    (count, row) => count + (row.errorFlag ? 1 : 0),
    0
  );

  const durationValues = rows
    .map((row) => row.durationMs ?? null)
    .filter((value): value is number => value != null && !Number.isNaN(value));
  const averageDurationMs = durationValues.length
    ? durationValues.reduce((sum, value) => sum + value, 0) /
      durationValues.length
    : null;

  return {
    totalRuns: rows.length,
    averageScore: totalScore / rows.length,
    errorCount,
    averageDurationMs,
  };
};

export function OperationRunsPage() {
  const params = useParams<{ taskLabel?: string }>();
  const location = useLocation();

  const fallbackTaskLabel = useMemo(() => {
    const match = location.pathname.match(/\/operations\/(?<label>[^/]+)\/?$/);
    if (!match || !match.groups?.label) {
      return null;
    }
    try {
      return decodeURIComponent(match.groups.label);
    } catch {
      return match.groups.label;
    }
  }, [location.pathname]);

  const taskLabelParam = params?.taskLabel ?? fallbackTaskLabel;

  // Trim and normalise the operation id from the route before using it.
  const normalizedTaskLabel = useMemo(() => {
    if (!taskLabelParam) {
      return null;
    }
    const trimmed = taskLabelParam.trim();
    return trimmed.length ? trimmed : null;
  }, [taskLabelParam]);

  const [limit, setLimit] = useState(INITIAL_LIMIT);

  // Reset the pagination window when navigating between different operations.
  useEffect(() => {
    setLimit(INITIAL_LIMIT);
  }, [normalizedTaskLabel]);

  const { responses, loading, error } = useAssistantNpsRecent(limit, {
    taskLabel: normalizedTaskLabel ?? undefined,
  });

  const operationRows = useMemo(
    () =>
      normalizedTaskLabel
        ? responses.filter(
            (row) => !row.metadata.isTurnFeedback && row.metadata.llmFeedback
          )
        : [],
    [responses, normalizedTaskLabel]
  );

  const summary = useMemo(() => computeSummary(operationRows), [operationRows]);

  const canLoadMore =
    Boolean(normalizedTaskLabel) &&
    !loading &&
    responses.length >= limit &&
    limit < MAX_LIMIT;

  const handleLoadMore = () => {
    setLimit((prev) => Math.min(MAX_LIMIT, prev + LOAD_INCREMENT));
  };

  const headerDescription = normalizedTaskLabel
    ? "Review qualitative feedback for recent runs that executed this operation."
    : "Unable to locate a matching operation. Check the link and try again.";

  const summaryItems = [
    {
      label: "Runs Displayed",
      value: summary.totalRuns.toString(),
    },
    {
      label: "Average Score",
      value: formatAverageScore(summary.averageScore),
      valueClassName:
        summary.averageScore == null
          ? "text-ui-fg-subtle"
          : getScoreColor(summary.averageScore),
    },
    {
      label: "Errors",
      value: summary.errorCount.toString(),
      valueClassName: summary.errorCount > 0 ? "text-red-600" : "text-green-600",
    },
    {
      label: "Avg Duration",
      value: formatDuration(summary.averageDurationMs),
    },
  ];

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Link
          to="/internal/metrics"
          className="text-sm font-medium text-ui-fg-interactive hover:underline"
        >
          ← Back to Metrics
        </Link>
        <Heading level="h1" className="text-2xl mt-2 mb-1">
          {normalizedTaskLabel ?? "Unknown Operation"}
        </Heading>
        <Text className="text-ui-fg-subtle">{headerDescription}</Text>
      </div>

      <div className="px-6 py-6 space-y-6">
        {normalizedTaskLabel && (
          <div className="rounded-lg border bg-ui-bg-base p-4 shadow-sm">
            <Heading level="h2" className="text-lg mb-2">
              Operation Summary
            </Heading>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {summaryItems.map((item) => (
                <div key={item.label} className="space-y-2">
                  <Text
                    size="xsmall"
                    className="text-ui-fg-subtle uppercase tracking-wide"
                  >
                    {item.label}
                  </Text>
                  <Text
                    weight="plus"
                    className={`text-lg ${
                      item.valueClassName ?? "text-ui-fg-base"
                    }`}
                  >
                    {item.value}
                  </Text>
                </div>
              ))}
            </div>
            <Badge size="small" className="mt-3">
              Showing up to {limit} recent runs
            </Badge>
          </div>
        )}

        {!normalizedTaskLabel ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <Heading level="h2" className="text-lg mb-2">
              Operation not found
            </Heading>
            <Text className="text-red-600">
              The requested operation id is empty. Use the navigation above to
              return to the metrics overview and select a valid operation.
            </Text>
          </div>
        ) : loading && operationRows.length === 0 ? (
          <div className="rounded-lg border bg-ui-bg-subtle p-8 text-center">
            <Text className="text-ui-fg-subtle">Loading operation runs…</Text>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <Text className="text-red-600">{error}</Text>
          </div>
        ) : operationRows.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-ui-bg-subtle p-8 text-center">
            <Text className="text-ui-fg-subtle">
              No ANPS responses recorded for this operation yet.
            </Text>
          </div>
        ) : (
          <div className="space-y-4">
            {operationRows.map((row) => (
              <OperationFeedbackCard key={row.id} row={row} />
            ))}

            {canLoadMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="secondary"
                  onClick={handleLoadMore}
                  disabled={loading}
                >
                  {loading ? "Loading…" : "Load more runs"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Container>
  );
}
