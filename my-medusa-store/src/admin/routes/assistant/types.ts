import type { ChartSpec } from "./ChartRenderer"; // keep your existing type
import type { ConversationEntry } from "../../../modules/assistant/lib/types";

export type Category = "" | "customers" | "orders" | "products" | "promotions";

export interface AssistantResponse {
  answer: string;
  history: ConversationEntry[];
  chart?: ChartSpec | null;
  sessionId: string | null;
}

export type AssistantSession = {
  sessionId: string;
  history: ConversationEntry[];
  updatedAt: Date | null;
};
