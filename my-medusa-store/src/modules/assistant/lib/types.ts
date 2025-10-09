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

/**
 * Input for the `prompt` method in the Assistant service.
 */
export type PromptInput = {
  prompt: string;
  actorId: string;
};

/**
 * Defines the shape of a pending action that requires user validation.
 */
export type ValidationRequest = {
  id: string;
  operationId: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
};

/**
 * The result object returned by the `prompt` method.
 */
export type PromptResult = {
  answer: string;
  history: ConversationEntry[];
  updatedAt: Date;
  validationRequest?: ValidationRequest;
};

// Database Row Types

/**
 * Represents a row in the `conversation_session` database table.
 */
export type ConversationRow = {
  id: string;
  actor_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * Represents a row in the `conversation_message` database table.
 */
export type MessageRow = {
  id: string;
  session_id: string;
  question: string;
  answer: string | null;
  created_at: Date | string;
};
