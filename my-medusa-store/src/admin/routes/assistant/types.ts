import type { ConversationEntry } from "../../../modules/assistant/lib/types";

export type Category = "" | "customers" | "orders" | "products" | "promotions";

export type ValidationRequest = {
  id: string;
  operationId: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
  bodyFieldEnums?: Record<string, string[]>;
  bodyFieldReadOnly?: string[];
  resourcePreview?: Record<string, unknown>;
};

export interface AssistantResponse {
  answer: string;
  history: ConversationEntry[];
  updatedAt: Date | null;
  validationRequest?: ValidationRequest;
}

export type AssistantConversation = {
  history: ConversationEntry[];
  updatedAt: Date | null;
};
