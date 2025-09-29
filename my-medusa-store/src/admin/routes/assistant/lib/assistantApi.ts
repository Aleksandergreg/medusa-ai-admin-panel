import { z } from "zod";
import type { AssistantResponse } from "../types";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

const ChartSpecSchema = z.any(); // if you have a stricter ChartSpec, swap it in

const AssistantResponseSchema = z.object({
  response: z.string().default(""),
  chart: ChartSpecSchema.nullish(),
});

export type AskPayload = {
  prompt: string;
  wantsChart: boolean;
  chartType: "bar" | "line";
  chartTitle?: string;
  history?: ConversationEntry[];
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
    chart: parsed.data.chart,
  };
}
