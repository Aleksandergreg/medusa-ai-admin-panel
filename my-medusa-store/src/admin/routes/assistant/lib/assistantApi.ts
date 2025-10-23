import { z } from "zod";
import type {
  AssistantResponse,
  AssistantConversation,
  ConversationSummary,
} from "../types";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

const ConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const ValidationRequestSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  method: z.string(),
  path: z.string(),
  args: z.record(z.unknown()),
  bodyFieldEnums: z.record(z.array(z.string())).optional(),
  resourcePreview: z.record(z.unknown()).optional(),
});

const AssistantResponseSchema = z.object({
  response: z.string().default(""),
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
  sessionId: z.string().optional(),
  validationRequest: ValidationRequestSchema.optional(),
});

const AssistantConversationSchema = z.object({
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
});

const AssistantNpsMetricsSchema = z.object({
  last30Days: z.object({
    responses: z.number().min(0),
    nps: z.number().nullable(),
  }),
  byTask: z
    .array(
      z.object({
        taskLabel: z.string().nullable(),
        responses: z.number().min(0),
        nps: z.number().nullable(),
      })
    )
    .default([]),
});

const LlmFeedbackSchema = z.object({
  summary: z.string(),
  positives: z.array(z.string()).default([]),
  suggestions: z.array(z.string()).default([]),
});

const TurnOperationSchema = z.object({
  operationId: z.string(),
  taskLabel: z.string().nullable(),
  score: z.number().optional(),
  attempts: z.number().optional(),
  errors: z.number().optional(),
  durationMs: z.number().nullable().optional(),
  errorFlag: z.boolean().optional(),
  errorSummary: z.string().nullable().optional(),
  lastStatusCode: z.number().nullable().optional(),
  lastStatusMessage: z.string().nullable().optional(),
});

const TurnAggregateSchema = z.object({
  totalOperations: z.number().optional(),
  averageScore: z.number().optional(),
  bestScore: z.number().optional(),
  lowestScore: z.number().optional(),
  totalAttempts: z.number().optional(),
  totalErrors: z.number().optional(),
  durationMs: z.number().nullable().optional(),
  agentComputeMs: z.number().nullable().optional(),
});

type TurnOperationMeta = z.infer<typeof TurnOperationSchema>;
type TurnAggregateMeta = z.infer<typeof TurnAggregateSchema>;

const LIST_PREFIX_PATTERN = /^\s*(?:[-*•●]+(?=\s)|\d+[.)](?=\s))/;

const sanitizeListItem = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  if (/^[-*•●]+$/.test(trimmed)) {
    return "";
  }

  if (LIST_PREFIX_PATTERN.test(trimmed)) {
    return trimmed.replace(LIST_PREFIX_PATTERN, "").trimStart();
  }

  return trimmed;
};

export const extractFeedbackItems = (value: unknown, limit = 5): string[] => {
  if (limit <= 0 || value == null) {
    return [];
  }

  const items: string[] = [];
  const seen = new Set<string>();

  const addItem = (candidate: string) => {
    const cleaned = sanitizeListItem(candidate);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }
    seen.add(cleaned);
    items.push(cleaned);
  };

  const visit = (input: unknown): void => {
    if (items.length >= limit || input == null) {
      return;
    }

    if (typeof input === "string") {
      const segments = input.split(/\r?\n+/);
      if (segments.length > 1) {
        for (const segment of segments) {
          if (items.length >= limit) {
            break;
          }
          addItem(segment);
        }
      } else {
        addItem(input);
      }
      return;
    }

    if (Array.isArray(input)) {
      for (const entry of input) {
        if (items.length >= limit) {
          break;
        }
        visit(entry);
      }
      return;
    }

    if (typeof input === "object" && input !== null) {
      const record = input as Record<string, unknown>;
      for (const key of ["text", "value", "content", "message"]) {
        if (typeof record[key] === "string") {
          visit(record[key]);
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
        if (Array.isArray(record[key])) {
          visit(record[key]);
        }
      }
    }
  };

  visit(value);
  return items;
};

const AssistantNpsRowSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  agent_id: z.string(),
  agent_version: z.string().nullable(),
  session_id: z.string(),
  user_id: z.string().nullable(),
  score: z.number(),
  task_label: z.string().nullable(),
  operation_id: z.string().nullable(),
  tools_used: z.array(z.record(z.unknown())).default([]),
  duration_ms: z.number().nullable(),
  error_flag: z.boolean(),
  error_summary: z.string().nullable(),
  user_permission: z.boolean(),
  client_metadata: z
    .record(z.unknown())
    .optional()
    .nullable()
    .transform((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }
      const metadata = value as Record<string, unknown>;
      const feedbackRaw = metadata.llmFeedback;
      const parsedFeedback = LlmFeedbackSchema.safeParse(feedbackRaw);

      const operations: z.infer<typeof TurnOperationSchema>[] = [];
      if (Array.isArray(metadata.operations)) {
        for (const entry of metadata.operations) {
          const parsed = TurnOperationSchema.safeParse(entry);
          if (parsed.success) {
            operations.push(parsed.data);
          }
        }
      }

      let aggregate: z.infer<typeof TurnAggregateSchema> | null = null;
      if (metadata.aggregate) {
        const parsedAggregate = TurnAggregateSchema.safeParse(
          metadata.aggregate
        );
        if (parsedAggregate.success) {
          aggregate = parsedAggregate.data;
        }
      }

      const fallbackSuggestions = (() => {
        if (
          feedbackRaw &&
          typeof feedbackRaw === "object" &&
          feedbackRaw !== null
        ) {
          const record = feedbackRaw as Record<string, unknown>;
          const improvementKeys = [
            "improvements",
            "improvement_suggestions",
            "areasForImprovement",
            "areas_for_improvement",
            "improvementPoints",
          ];
          for (const key of improvementKeys) {
            const extracted = extractFeedbackItems(record[key]);
            if (extracted.length) {
              return extracted;
            }
          }
        }
        return [];
      })();

      let llmFeedback: AssistantNpsResponseRow["metadata"]["llmFeedback"] =
        null;

      if (parsedFeedback.success) {
        const positives = extractFeedbackItems(parsedFeedback.data.positives);
        const normalizedSuggestions = extractFeedbackItems(
          parsedFeedback.data.suggestions
        );
        const suggestions =
          normalizedSuggestions.length > 0
            ? normalizedSuggestions
            : fallbackSuggestions;

        llmFeedback = {
          summary: parsedFeedback.data.summary,
          positives,
          suggestions,
        };
      }

      return {
        feedback:
          typeof metadata.feedback === "string" ? metadata.feedback : null,
        llmFeedback: llmFeedback,
        isTurnFeedback: metadata.isTurnFeedback === true,
        operations,
        aggregate,
        prompt:
          typeof metadata.userPrompt === "string" ? metadata.userPrompt : null,
      };
    }),
});

const AssistantNpsListSchema = z.object({
  rows: z.array(AssistantNpsRowSchema).default([]),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toAssistantResponse = (json: unknown): AssistantResponse => {
  const parsed = AssistantResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    answer: parsed.data.response,
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
    sessionId: parsed.data.sessionId,
    validationRequest: parsed.data.validationRequest,
  };
};

export type AssistantNpsMetrics = z.infer<typeof AssistantNpsMetricsSchema>;

export type AssistantNpsResponseRow = {
  id: string;
  createdAt: Date;
  agentId: string;
  agentVersion: string | null;
  sessionId: string;
  userId: string | null;
  score: number;
  taskLabel: string | null;
  operationId: string | null;
  toolsUsed: Record<string, unknown>[];
  durationMs: number | null;
  errorFlag: boolean;
  errorSummary: string | null;
  metadata: {
    feedback: string | null;
    llmFeedback: {
      summary: string;
      positives: string[];
      suggestions: string[];
    } | null;
    isTurnFeedback: boolean;
    operations: TurnOperationMeta[];
    aggregate: TurnAggregateMeta | null;
    prompt: string | null;
  };
};

export async function askAssistant(
  payload: { prompt: string; sessionId?: string },
  signal?: AbortSignal
): Promise<AssistantResponse> {
  const res = await fetch("/admin/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  return toAssistantResponse(json);
}

export async function fetchAssistantConversation(
  signal?: AbortSignal
): Promise<AssistantConversation> {
  const res = await fetch("/admin/assistant", {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantConversationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
  };
}

export async function fetchAssistantNpsMetrics(
  signal?: AbortSignal
): Promise<AssistantNpsMetrics> {
  const res = await fetch("/admin/assistant/anps/metrics", {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantNpsMetricsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid ANPS metrics response from server");
  }
  return parsed.data;
}

export type AssistantNpsListParams = {
  limit?: number;
  taskLabel?: string;
};

export async function fetchAssistantNpsResponses(
  params: AssistantNpsListParams = {},
  signal?: AbortSignal
): Promise<AssistantNpsResponseRow[]> {
  const searchParams = new URLSearchParams();
  if (Number.isFinite(params.limit) && (params.limit ?? 0) > 0) {
    searchParams.set("limit", String(Math.floor(params.limit!)));
  }
  if (params.taskLabel && params.taskLabel.trim()) {
    searchParams.set("taskLabel", params.taskLabel.trim());
  }

  const query = searchParams.toString();
  const url = query
    ? `/admin/assistant/anps?${query}`
    : "/admin/assistant/anps";

  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantNpsListSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid ANPS list response from server");
  }

  return parsed.data.rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.created_at),
    agentId: row.agent_id,
    agentVersion: row.agent_version,
    sessionId: row.session_id,
    userId: row.user_id,
    score: row.score,
    taskLabel: row.task_label,
    operationId: row.operation_id,
    toolsUsed: row.tools_used,
    durationMs: row.duration_ms,
    errorFlag: row.error_flag,
    errorSummary: row.error_summary,
    metadata: row.client_metadata ?? {
      feedback: null,
      llmFeedback: null,
      isTurnFeedback: false,
      operations: [],
      aggregate: null,
    },
  }));
}

export async function approveAssistantValidation(
  id: string,
  editedData?: Record<string, unknown>
): Promise<AssistantResponse> {
  const res = await fetch("/admin/assistant/validation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id, approved: true, editedData }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  return toAssistantResponse(json);
}

export async function rejectAssistantValidation(
  id: string
): Promise<AssistantResponse> {
  const res = await fetch("/admin/assistant/validation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id, approved: false }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  return toAssistantResponse(json);
}

export async function cancelAssistantRequest(
  sessionId?: string
): Promise<{ cancelled: boolean; message: string }> {
  const res = await fetch("/admin/assistant/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ sessionId }),
  });

  const json = await res.json().catch((parseError) => {
    console.warn("Failed to parse cancel response JSON:", parseError);
    return {};
  });

  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Cancellation request failed with ${res.status}`;
    throw new Error(msg);
  }

  return {
    cancelled: json.cancelled === true,
    message: json.message || "Request processed",
  };
}

export async function listConversations(
  signal?: AbortSignal
): Promise<ConversationSummary[]> {
  const res = await fetch("/admin/conversations", {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  return json.conversations || [];
}

export async function createConversation(
  title?: string
): Promise<{ id: string; title: string }> {
  const res = await fetch("/admin/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  return json.conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/admin/conversations/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }
}

export async function updateConversationTitle(
  id: string,
  title: string
): Promise<void> {
  const res = await fetch(`/admin/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }
}

export async function fetchConversationById(
  id: string,
  signal?: AbortSignal
): Promise<AssistantConversation> {
  const res = await fetch(`/admin/conversations/${id}`, {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && isRecord(json) && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantConversationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
  };
}
