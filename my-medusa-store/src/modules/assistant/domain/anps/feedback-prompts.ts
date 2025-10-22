import { AgentNpsEvaluation } from "./types";
import { StatusDigest } from "./status-digest";
import { truncateText } from "./feedback-formatting";

type OperationDescriptor = {
  operationId: string;
  taskLabel: string | null;
};

type StatusAwareOperation = OperationDescriptor & {
  evaluation: AgentNpsEvaluation;
  statuses: StatusDigest[];
};

const formatDuration = (durationMs: number | null | undefined): string => {
  if (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    return `${(durationMs / 1000).toFixed(1)} seconds`;
  }
  return "not recorded";
};

const formatStatusSection = (statusMessages: StatusDigest[]): string => {
  if (!statusMessages.length) {
    return "No HTTP tool calls were captured for this operation.";
  }

  return statusMessages
    .map((item, idx) => {
      const code =
        item.statusCode != null ? `status ${item.statusCode}` : "unknown status";
      const summary = item.operationSummary ?? "Unnamed call";
      const message = item.message ? ` — ${item.message}` : "";
      return `${idx + 1}. ${summary} (${code})${message}`;
    })
    .join("\n");
};

const formatOtherOperations = (
  operations: OperationDescriptor[]
): string | null => {
  if (!operations.length) {
    return null;
  }

  const lines = operations
    .map((op, idx) => {
      const label = op.taskLabel ?? op.operationId;
      return `${idx + 1}. ${label} (${op.operationId})`;
    })
    .join("\n");

  return ["Other operations executed in this assistant turn:", lines].join("\n");
};

const buildQuantitativeSection = (evaluation: AgentNpsEvaluation): string => {
  const durationSeconds = formatDuration(evaluation.durationMs);

  const bullets = [
    `Heuristic score: ${evaluation.score}/10`,
    `Attempts: ${evaluation.attempts}`,
    `Errors: ${evaluation.errors}`,
    `Duration: ${durationSeconds}`,
    `Error flag: ${evaluation.errorFlag ? "true" : "false"}`,
  ];

  if (evaluation.errorSummary) {
    bullets.push(`Error summary: ${evaluation.errorSummary}`);
  }

  if (evaluation.feedbackNote) {
    bullets.push(`Heuristic notes: ${evaluation.feedbackNote}`);
  }

  return bullets.join("\n");
};

export const buildOperationFeedbackPrompt = (params: {
  operationId: string;
  taskLabel: string | null;
  evaluation: AgentNpsEvaluation;
  statusMessages: StatusDigest[];
  answer?: string | null;
  relatedOperations?: OperationDescriptor[];
}): string => {
  const statusSection = formatStatusSection(params.statusMessages);

  const otherOperations =
    params.relatedOperations?.filter(
      (op) => op.operationId !== params.operationId
    ) ?? [];

  const otherOperationsSection = formatOtherOperations(otherOperations);

  const answerSnippet = truncateText(params.answer, 1500);

  const promptSections = [
    "You are reviewing a Medusa commerce assistant task execution.",
    `Operation ID: ${params.operationId}`,
    params.taskLabel ? `Task label: ${params.taskLabel}` : null,
    "### Quantitative observations",
    buildQuantitativeSection(params.evaluation),
    "### HTTP interaction summary",
    statusSection,
    otherOperationsSection,
    answerSnippet ? `### Assistant reply\n${answerSnippet}` : null,
    "Write a concise qualitative review highlighting what worked well and what should improve. Be specific about API usage or payload clarity when possible.",
    "Focus your analysis on the target operation above. Other operations are listed only for context; do not assume their HTTP calls should appear in this summary.",
    'Respond as valid JSON using this schema: {"feedback":"<short paragraph>","positives":["..."],"suggestions":["..."]}.',
  ].filter((section): section is string => typeof section === "string");

  return promptSections.join("\n\n");
};

const formatOperationSummary = (
  operation: StatusAwareOperation,
  index: number
): string => {
  const evaln = operation.evaluation;
  const label = operation.taskLabel ?? operation.operationId;
  const lastStatus =
    operation.statuses.length > 0
      ? operation.statuses[operation.statuses.length - 1]
      : null;
  const statusText = lastStatus
    ? `last status ${lastStatus.statusCode ?? "unknown"}`
    : "status unknown";
  const durationText =
    typeof evaln.durationMs === "number" && evaln.durationMs > 0
      ? `${(evaln.durationMs / 1000).toFixed(1)}s`
      : "n/a";
  return `${index + 1}. ${label} — score ${evaln.score}/10, attempts ${evaln.attempts}, errors ${evaln.errors}, duration ${durationText}, ${statusText}`;
};

const formatStatusBreakdown = (operations: StatusAwareOperation[]): string => {
  const sections = operations.map((operation) => {
    const label = operation.taskLabel ?? operation.operationId;
    if (!operation.statuses.length) {
      return `- ${label}: No HTTP interactions recorded for this operation.`;
    }
    const notes = operation.statuses
      .map((status, idx) => {
        const base = `${idx + 1}. status ${
          status.statusCode ?? "unknown"
        } — ${status.operationSummary ?? operation.operationId}`;
        const message =
          status.message && status.message.trim()
            ? ` (message: ${status.message.trim()})`
            : "";
        return `${base}${message}`;
      })
      .join("\n");
    return `- ${label}:\n${notes}`;
  });

  return sections.join("\n");
};

const formatAggregateLines = (params: {
  operations: StatusAwareOperation[];
  durationMs: number;
  agentComputeMs?: number | null;
}): string => {
  const averageScore =
    params.operations.reduce((acc, item) => acc + item.evaluation.score, 0) /
    params.operations.length;
  const totalAttempts = params.operations.reduce(
    (acc, item) => acc + item.evaluation.attempts,
    0
  );
  const totalErrors = params.operations.reduce(
    (acc, item) => acc + item.evaluation.errors,
    0
  );
  const worstScore = Math.min(
    ...params.operations.map((item) => item.evaluation.score)
  );
  const bestScore = Math.max(
    ...params.operations.map((item) => item.evaluation.score)
  );

  const durationSeconds = formatDuration(params.durationMs);
  const computeSeconds =
    params.agentComputeMs &&
    Number.isFinite(params.agentComputeMs) &&
    params.agentComputeMs > 0
      ? `${(params.agentComputeMs / 1000).toFixed(1)} seconds`
      : null;

  const lines = [
    `Operations executed: ${params.operations.length}`,
    `Average score: ${averageScore.toFixed(1)}/10`,
    `Best score: ${bestScore}/10`,
    `Lowest score: ${worstScore}/10`,
    `Total attempts: ${totalAttempts}`,
    `Total errors: ${totalErrors}`,
    `Turn duration: ${durationSeconds}`,
  ];

  if (computeSeconds) {
    lines.push(`Agent compute time: ${computeSeconds}`);
  }

  return lines.join("\n");
};

export const buildTurnSummaryPrompt = (params: {
  operations: StatusAwareOperation[];
  durationMs: number;
  agentComputeMs?: number | null;
  answer?: string | null;
}): string => {
  const operationSummaries = params.operations
    .map((operation, index) => formatOperationSummary(operation, index))
    .join("\n");

  const statusBreakdown = formatStatusBreakdown(params.operations);

  const answerSnippet = truncateText(params.answer, 2000);

  const promptSections = [
    "You are reviewing the entire workflow from an AI assistant turn in a Medusa commerce environment.",
    "Provide insights on the overall plan, tool usage, and risks across the full set of operations. Highlight sequencing issues, missing validations, or redundant calls.",
    "### Aggregate metrics",
    formatAggregateLines({
      operations: params.operations,
      durationMs: params.durationMs,
      agentComputeMs: params.agentComputeMs,
    }),
    "### Operation summaries",
    operationSummaries,
    "### HTTP interaction details",
    statusBreakdown,
    answerSnippet ? `### Assistant final reply\n${answerSnippet}` : null,
    'Respond with JSON matching this schema: {"feedback":"...","positives":["..."],"suggestions":["..."]}. Emphasize improvements that span multiple operations when applicable.',
  ].filter((section): section is string => typeof section === "string");

  return promptSections.join("\n\n");
};
