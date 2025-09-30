import { z } from "zod";
import type { AssistantResponse, AssistantSession } from "../types";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

const ChartSpecSchema = z.any(); // if you have a stricter ChartSpec, swap it in

const ConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const AssistantResponseSchema = z.object({
  answer: z.string().default(""),
  chart: ChartSpecSchema.nullish(),
  history: z.array(ConversationEntrySchema).default([]),
  sessionId: z.string().optional(),
});

const AssistantSessionSchema = z.object({
  sessionId: z.string(),
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
});

export type AskPayload = {
  prompt: string;
  wantsChart: boolean;
  chartType: "bar" | "line";
  chartTitle?: string;
  sessionId?: string;
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
    chart: parsed.data.chart ?? null,
    history: parsed.data.history as ConversationEntry[],
    sessionId: parsed.data.sessionId ?? null,
  };
}

export async function fetchAssistantSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<AssistantSession> {
  const url = `/custom/assistant?sessionId=${encodeURIComponent(sessionId)}`;
  const res = await fetch(url, {
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

  const parsed = AssistantSessionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    sessionId: parsed.data.sessionId,
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
  };
}
