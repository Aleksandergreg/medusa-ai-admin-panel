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
  bodyFieldReadOnly: z.array(z.string()).optional(),
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
      return {
        feedback: typeof metadata.feedback === "string" ? metadata.feedback : null,
        llmFeedback:
          parsedFeedback.success
            ? {
                summary: parsedFeedback.data.summary,
                positives: parsedFeedback.data.positives,
                suggestions: parsedFeedback.data.suggestions,
              }
            : null,
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

export async function fetchAssistantNpsResponses(
  limit = 10,
  signal?: AbortSignal
): Promise<AssistantNpsResponseRow[]> {
  const params = new URLSearchParams();
  if (Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.floor(limit)));
  }

  const query = params.toString();
  const url = query ? `/admin/assistant/anps?${query}` : "/admin/assistant/anps";

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
    metadata: row.client_metadata ?? { feedback: null, llmFeedback: null },
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
