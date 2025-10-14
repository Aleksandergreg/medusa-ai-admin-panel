export type McpTool = {
  name: string;
  description?: string;
  input_schema?: any;
};

export type HistoryEntry = {
  tool_name: string;
  tool_args: any;
  tool_result: any;
};

export type ConversationEntry = {
  role: "user" | "assistant";
  content: string;
};

export type InitialOperation = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
};

// Service Layer Types

export type PromptInput = {
  prompt: string;
  actorId: string;
};


// Re-export the canonical validation types to avoid duplication
export type { ValidationRequest } from "./validation-types";


export type PromptResult = {
  answer: string;
  history: ConversationEntry[];
  updatedAt: Date;
  validationRequest?: ValidationRequest;
};

// Database Row Types


export type ConversationRow = {
  id: string;
  actor_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};


export type MessageRow = {
  id: string;
  session_id: string;
  question: string;
  answer: string | null;
  created_at: Date | string;
};
