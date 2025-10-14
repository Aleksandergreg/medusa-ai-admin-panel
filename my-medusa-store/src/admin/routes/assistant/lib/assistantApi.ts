import { z } from "zod";
import type { AssistantResponse, AssistantConversation } from "../types";
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
  validationRequest: ValidationRequestSchema.optional(),
});

const AssistantConversationSchema = z.object({
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
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
    validationRequest: parsed.data.validationRequest,
  };
};

export async function askAssistant(
  payload: { prompt: string },
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
