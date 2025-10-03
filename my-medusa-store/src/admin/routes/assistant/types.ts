import type { ConversationEntry } from "../../../modules/assistant/lib/types";

export type Category = "" | "customers" | "orders" | "products" | "promotions";

export interface AssistantResponse {
  answer: string;
  history: ConversationEntry[];
  sessionId: string | null;
}

export type AssistantSession = {
  sessionId: string | null;
  history: ConversationEntry[];
  updatedAt: Date | null;
};
