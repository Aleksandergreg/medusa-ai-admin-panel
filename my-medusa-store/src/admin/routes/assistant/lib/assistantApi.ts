import { z } from "zod";
import type { AssistantResponse, AssistantSession } from "../types";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

const ConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const AssistantResponseSchema = z.object({
  response: z.string().default(""),
  history: z.array(ConversationEntrySchema).default([]),
  sessionId: z.string().nullish(),
});

const AssistantConversationSchema = z.object({
  sessionId: z.string().nullish(),
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
});

export type AskPayload = {
  prompt: string;
};

export async function askAssistant(
  payload: AskPayload,
  signal?: AbortSignal
): Promise<AssistantResponse> {
  const res = await fetch("/custom/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    answer: parsed.data.response,
    history: parsed.data.history as ConversationEntry[],
    sessionId: parsed.data.sessionId ?? null,
  };
}

export async function fetchAssistantConversation(
  signal?: AbortSignal
): Promise<AssistantSession> {
  const res = await fetch("/custom/assistant", {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantConversationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    sessionId: parsed.data.sessionId ?? null,
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
  };
}
