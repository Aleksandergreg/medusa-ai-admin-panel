import type { ConversationEntry } from "../../../modules/assistant/lib/types";

export type Category = "" | "customers" | "orders" | "products" | "promotions";

export interface AssistantResponse {
  answer: string;
  history: ConversationEntry[];
  updatedAt: Date | null;
  validationRequest?: {
    id: string;
    operationId: string;
    method: string;
    path: string;
    args: Record<string, unknown>;
  };
}

export type AssistantConversation = {
  history: ConversationEntry[];
  updatedAt: Date | null;
};
