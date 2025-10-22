import { GoogleGenAI } from "@google/genai";
import { AssistantModuleOptions } from "../../config";
import { HistoryEntry } from "../../lib/types";
import {
  extractToolJsonPayload,
  isPlainRecord,
  safeParseJSON,
} from "../../lib/utils";
import { AgentNpsEvaluation } from "./types";

type StatusDigest = {
  statusCode: number | null;
  message: string | null;
  operationSummary: string | null;
};

export type QualitativeFeedback = {
  summary: string;
  positives: string[];
  suggestions: string[];
};

type FeedbackPayload = {
  ok?: boolean;
  feedback?: string;
  positives?: unknown;
  suggestions?: unknown;
  improvements?: unknown;
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_STATUS_ENTRIES = 5;
const MAX_TEXT_CHARS = 4000;
const MAX_POSITIVE_ITEMS = 5;
const MAX_SUGGESTION_ITEMS = 5;

const sanitizeListItem = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const withoutPrefix = trimmed
    .replace(/^\s*(?:[-*•●]+|\d+[.)])\s*/, "")
    .trim();
  return withoutPrefix;
};

const normalizeFeedbackItems = (
  input: unknown,
  limit: number
): string[] => {
  if (!input || limit <= 0) {
    return [];
  }

  const items: string[] = [];
  const seen = new Set<string>();

  const addItem = (raw: string) => {
    const cleaned = sanitizeListItem(raw);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }
    seen.add(cleaned);
    items.push(cleaned);
  };

  const visit = (value: unknown): void => {
    if (items.length >= limit || value == null) {
      return;
    }

    if (typeof value === "string") {
      const segments = value.split(/\r?\n+/);
      if (segments.length > 1) {
        for (const segment of segments) {
          if (items.length >= limit) {
            break;
          }
          addItem(segment);
        }
      } else {
        addItem(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (items.length >= limit) {
          break;
        }
        visit(entry);
      }
      return;
    }

    if (isPlainRecord(value)) {
      const record = value as Record<string, unknown>;

      for (const key of ["text", "value", "content", "message"]) {
        const candidate = record[key];
        if (typeof candidate === "string") {
          visit(candidate);
        }
      }

      for (const key of [
        "items",
        "values",
        "entries",
        "list",
        "suggestions",
        "improvements",
        "positives",
      ]) {
        const candidate = record[key];
        if (Array.isArray(candidate)) {
          visit(candidate);
        }
      }
    }
  };

  visit(input);

  return items.slice(0, limit);
};

const normalizeOperationIdentifier = (value: string): string =>
  value.toLowerCase().replace(/[_\s-]+/g, "");

const extractOperationId = (args: Record<string, unknown>): string | null => {
  const camel = args.operationId;
  if (typeof camel === "string" && camel.trim()) {
    return camel.trim();
  }
  const snake = (args as Record<string, unknown>).operation_id;
  if (typeof snake === "string" && snake.trim()) {
    return snake.trim();
  }
  return null;
};

const coerceStatusCode = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

export const summarizeStatusMessages = (
  history: HistoryEntry[],
  operationId: string
): StatusDigest[] => {
  const normalizedTarget = normalizeOperationIdentifier(operationId);
  const digests: StatusDigest[] = [];

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry.tool_name !== "openapi.execute") {
      continue;
    }
    const args =
      entry.tool_args && typeof entry.tool_args === "object"
        ? (entry.tool_args as Record<string, unknown>)
        : null;
    if (!args) {
      continue;
    }
    const entryId = extractOperationId(args);
    if (!entryId) {
      continue;
    }
    const normalizedEntry = normalizeOperationIdentifier(entryId);
    if (normalizedEntry !== normalizedTarget) {
      continue;
    }

    const payload = extractToolJsonPayload(entry.tool_result);
    let statusCode: number | null = null;
    let message: string | null = null;

    if (isPlainRecord(payload)) {
      statusCode =
        coerceStatusCode(
          payload.statusCode ?? payload.status ?? payload.code
        ) ?? null;
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message.trim();
      } else if (typeof payload.error === "string" && payload.error.trim()) {
        message = payload.error.trim();
      } else if (typeof payload.title === "string" && payload.title.trim()) {
        message = payload.title.trim();
      }
    } else if (
      entry.tool_result &&
      typeof entry.tool_result === "object" &&
      (entry.tool_result as Record<string, unknown>).error
    ) {
      const rawError = (entry.tool_result as Record<string, unknown>).error;
      message =
        typeof rawError === "string" && rawError.trim()
          ? rawError.trim()
          : null;
    }

    const summary =
      typeof args.summary === "string" && args.summary.trim()
        ? args.summary.trim()
        : entryId;

    digests.push({
      statusCode,
      message,
      operationSummary: summary,
    });

    if (digests.length >= MAX_STATUS_ENTRIES) {
      break;
    }
  }

  return digests.reverse();
};

const truncate = (value: string | null | undefined, max = MAX_TEXT_CHARS) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};

const extractText = (res: unknown): string | null => {
  const read = (value: unknown): string | null => {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "function") {
      try {
        const output = (value as () => unknown)();
        return typeof output === "string" && output.trim()
          ? output.trim()
          : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const direct = read((res as { text?: unknown; response?: unknown })?.text);
  if (direct) {
    return direct;
  }

  const response = (res as { response?: unknown })?.response;
  const responseText = read((response as { text?: unknown })?.text);
  if (responseText) {
    return responseText;
  }

  const candidates =
    (response as { candidates?: unknown })?.candidates ??
    (res as { candidates?: unknown })?.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts =
        (candidate as { content?: { parts?: unknown }[] })?.content?.parts ??
        [];
      if (!Array.isArray(parts)) {
        continue;
      }
      const combined = parts
        .map((part) => read((part as { text?: unknown })?.text))
        .filter((text): text is string => typeof text === "string")
        .join("")
        .trim();
      if (combined) {
        return combined;
      }
    }
  }

  return null;
};

export async function generateQualitativeFeedback(params: {
  operationId: string;
  taskLabel: string | null;
  evaluation: AgentNpsEvaluation;
  history: HistoryEntry[];
  answer?: string | null;
  config: AssistantModuleOptions;
  relatedOperations?: { operationId: string; taskLabel: string | null }[];
}): Promise<QualitativeFeedback | null> {
  const apiKey =
    params.config.geminiApiKey ?? process.env.ASSISTANT_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      JSON.stringify({
        event: "agent_feedback.skipped",
        reason: "missing_api_key",
      })
    );
    return null;
  }

  const model =
    process.env.ASSISTANT_FEEDBACK_MODEL ??
    params.config.modelName ??
    DEFAULT_MODEL;

  const statusMessages = summarizeStatusMessages(
    params.history,
    params.operationId
  );

  const durationSeconds =
    typeof params.evaluation.durationMs === "number" &&
    Number.isFinite(params.evaluation.durationMs) &&
    params.evaluation.durationMs > 0
      ? `${(params.evaluation.durationMs / 1000).toFixed(1)} seconds`
      : "not recorded";

  const quantitativeBullets = [
    `Heuristic score: ${params.evaluation.score}/10`,
    `Attempts: ${params.evaluation.attempts}`,
    `Errors: ${params.evaluation.errors}`,
    `Duration: ${durationSeconds}`,
    `Error flag: ${params.evaluation.errorFlag ? "true" : "false"}`,
  ];

  if (params.evaluation.errorSummary) {
    quantitativeBullets.push(
      `Error summary: ${params.evaluation.errorSummary}`
    );
  }

  if (params.evaluation.feedbackNote) {
    quantitativeBullets.push(
      `Heuristic notes: ${params.evaluation.feedbackNote}`
    );
  }

  const statusSection = statusMessages.length
    ? statusMessages
        .map((item, idx) => {
          const code =
            item.statusCode != null
              ? `status ${item.statusCode}`
              : "unknown status";
          const summary = item.operationSummary ?? "Unnamed call";
          const message = item.message ? ` — ${item.message}` : "";
          return `${idx + 1}. ${summary} (${code})${message}`;
        })
        .join("\n")
    : "No HTTP tool calls were captured for this operation.";

  const answerSnippet = truncate(params.answer, 1500);
  const otherOperations =
    params.relatedOperations?.filter(
      (op) => op.operationId !== params.operationId
    ) ?? [];
  const otherOperationsSection = otherOperations.length
    ? [
        "Other operations executed in this assistant turn:",
        otherOperations
          .map((op, idx) => {
            const label = op.taskLabel ?? op.operationId;
            return `${idx + 1}. ${label} (${op.operationId})`;
          })
          .join("\n"),
      ].join("\n")
    : null;

  const promptSections = [
    "You are reviewing a Medusa commerce assistant task execution.",
    `Operation ID: ${params.operationId}`,
    params.taskLabel ? `Task label: ${params.taskLabel}` : null,
    "### Quantitative observations",
    quantitativeBullets.join("\n"),
    "### HTTP interaction summary",
    statusSection,
    otherOperationsSection,
    answerSnippet ? `### Assistant reply\n${answerSnippet}` : null,
    "Write a concise qualitative review highlighting what worked well and what should improve. Be specific about API usage or payload clarity when possible.",
    "Focus your analysis on the target operation above. Other operations are listed only for context; do not assume their HTTP calls should appear in this summary.",
    'Respond as valid JSON using this schema: {"feedback":"<short paragraph>","positives":["..."],"suggestions":["..."]}.',
  ].filter((section): section is string => typeof section === "string");

  const prompt = promptSections.join("\n\n");

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 512,
      },
    });

    const text = extractText(result);

    if (!text || !text.trim()) {
      console.warn(
        JSON.stringify({
          event: "agent_feedback.empty_response",
        })
      );
      return null;
    }

    const parsed = safeParseJSON<FeedbackPayload>(text.trim());
    if (!parsed || typeof parsed !== "object") {
      console.warn(
        JSON.stringify({
          event: "agent_feedback.parse_failed",
          sample: text.trim().slice(0, 120),
        })
      );
      return null;
    }

    const feedback =
      typeof parsed.feedback === "string" && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : null;
    if (!feedback) {
      return null;
    }

    const positives = normalizeFeedbackItems(
      parsed.positives,
      MAX_POSITIVE_ITEMS
    );
    let suggestions = normalizeFeedbackItems(
      parsed.suggestions,
      MAX_SUGGESTION_ITEMS
    );
    if (!suggestions.length) {
      suggestions = normalizeFeedbackItems(
        parsed.improvements,
        MAX_SUGGESTION_ITEMS
      );
    }

    return {
      summary: feedback,
      positives,
      suggestions,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "agent_feedback.error",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return null;
  }
}

export async function generateTurnSummaryFeedback(params: {
  operations: {
    operationId: string;
    taskLabel: string | null;
    evaluation: AgentNpsEvaluation;
  }[];
  history: HistoryEntry[];
  answer?: string | null;
  config: AssistantModuleOptions;
  durationMs: number;
  agentComputeMs?: number | null;
}): Promise<QualitativeFeedback | null> {
  if (!params.operations.length) {
    return null;
  }

  const apiKey =
    params.config.geminiApiKey ?? process.env.ASSISTANT_GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      JSON.stringify({
        event: "agent_feedback.turn_skipped",
        reason: "missing_api_key",
      })
    );
    return null;
  }

  const model =
    process.env.ASSISTANT_FEEDBACK_MODEL ??
    params.config.modelName ??
    DEFAULT_MODEL;

  const operationsWithStatus = params.operations.map((item) => ({
    ...item,
    statuses: summarizeStatusMessages(params.history, item.operationId),
  }));

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

  const durationSeconds =
    params.durationMs && Number.isFinite(params.durationMs)
      ? `${(params.durationMs / 1000).toFixed(1)} seconds`
      : "not recorded";
  const computeSeconds =
    params.agentComputeMs &&
    Number.isFinite(params.agentComputeMs) &&
    params.agentComputeMs > 0
      ? `${(params.agentComputeMs / 1000).toFixed(1)} seconds`
      : null;

  const operationsSummary = operationsWithStatus
    .map((item, index) => {
      const evaln = item.evaluation;
      const label = item.taskLabel ?? item.operationId;
      const lastStatus =
        item.statuses.length > 0
          ? item.statuses[item.statuses.length - 1]
          : null;
      const statusText = lastStatus
        ? `last status ${lastStatus.statusCode ?? "unknown"}`
        : "status unknown";
      const durationText =
        typeof evaln.durationMs === "number" && evaln.durationMs > 0
          ? `${(evaln.durationMs / 1000).toFixed(1)}s`
          : "n/a";
      return `${index + 1}. ${label} — score ${evaln.score}/10, attempts ${
        evaln.attempts
      }, errors ${evaln.errors}, duration ${durationText}, ${statusText}`;
    })
    .join("\n");

  const statusBreakdown = operationsWithStatus
    .map((item) => {
      const label = item.taskLabel ?? item.operationId;
      if (!item.statuses.length) {
        return `- ${label}: No HTTP interactions recorded for this operation.`;
      }
      const notes = item.statuses
        .map((status, idx) => {
          const base = `${idx + 1}. status ${
            status.statusCode ?? "unknown"
          } — ${status.operationSummary ?? item.operationId}`;
          const message =
            status.message && status.message.trim()
              ? ` (message: ${status.message.trim()})`
              : "";
          return `${base}${message}`;
        })
        .join("\n");
      return `- ${label}:\n${notes}`;
    })
    .join("\n");

  const answerSnippet = truncate(params.answer, 2000);

  const aggregateLines = [
    `Operations executed: ${params.operations.length}`,
    `Average score: ${averageScore.toFixed(1)}/10`,
    `Best score: ${bestScore}/10`,
    `Lowest score: ${worstScore}/10`,
    `Total attempts: ${totalAttempts}`,
    `Total errors: ${totalErrors}`,
    `Turn duration: ${durationSeconds}`,
  ];
  if (computeSeconds) {
    aggregateLines.push(`Agent compute time: ${computeSeconds}`);
  }

  const promptSections = [
    "You are reviewing the entire workflow from an AI assistant turn in a Medusa commerce environment.",
    "Provide insights on the overall plan, tool usage, and risks across the full set of operations. Highlight sequencing issues, missing validations, or redundant calls.",
    "### Aggregate metrics",
    aggregateLines.join("\n"),
    "### Operation summaries",
    operationsSummary,
    "### HTTP interaction details",
    statusBreakdown,
    answerSnippet ? `### Assistant final reply\n${answerSnippet}` : null,
    'Respond with JSON matching this schema: {"feedback":"...","positives":["..."],"suggestions":["..."]}. Emphasize improvements that span multiple operations when applicable.',
  ].filter((section): section is string => typeof section === "string");

  const prompt = promptSections.join("\n\n");

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 512,
      },
    });

    const text = extractText(result);
    if (!text) {
      console.warn(
        JSON.stringify({
          event: "agent_feedback.turn_empty_response",
        })
      );
      return null;
    }

    const parsed = safeParseJSON<FeedbackPayload>(text.trim());
    if (!parsed || typeof parsed !== "object") {
      console.warn(
        JSON.stringify({
          event: "agent_feedback.turn_parse_failed",
          sample: text.trim().slice(0, 120),
        })
      );
      return null;
    }

    const feedback =
      typeof parsed.feedback === "string" && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : null;
    if (!feedback) {
      return null;
    }

    const positives = normalizeFeedbackItems(
      parsed.positives,
      MAX_POSITIVE_ITEMS
    );
    let suggestions = normalizeFeedbackItems(
      parsed.suggestions,
      MAX_SUGGESTION_ITEMS
    );
    if (!suggestions.length) {
      suggestions = normalizeFeedbackItems(
        parsed.improvements,
        MAX_SUGGESTION_ITEMS
      );
    }

    return {
      summary: feedback,
      positives,
      suggestions,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "agent_feedback.turn_error",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return null;
  }
}
