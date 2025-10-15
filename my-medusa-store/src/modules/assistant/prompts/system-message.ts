/**
 * Assembles the complete system message for the planner
 */
import { CORE_INSTRUCTIONS } from "./system-message-parts/instructions";
import {
  RESPONSE_FORMAT_REQUIREMENTS,
  RESPONSE_FORMAT_EXAMPLES,
} from "./system-message-parts/response-format";
import { API_RULES } from "./system-message-parts/api-rules";
import { ERROR_RECOVERY_STRATEGIES } from "./system-message-parts/error-recovery";
import { CONVERSATION_HISTORY_RULES } from "./system-message-parts/conversation-history";
import type { McpTool } from "../lib/types";
import { SIMILAR_QUESTIONS_HANDLING } from "./system-message-parts/similar-questions-handling";
import { OUTPUT_STYLE_REQUIREMENTS } from "./system-message-parts/output-style";
import { ADMIN_FRIENDLY_OUTPUT } from "./system-message-parts/admin-friendly-output";
import { MEDUSA_GLOSSARY } from "./system-message-parts/medusa-glossary";
import { API_CALLING_PATTERN } from "./system-message-parts/api-calling-pattern";
import { getContextAwareness } from "./system-message-parts/context-awareness";
import { BASE_ROLE } from "./system-message-parts/base-role";

export function buildSystemMessage(tools: McpTool[]): string {
  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.input_schema ?? undefined,
  }));

  return [
    BASE_ROLE,
    getContextAwareness(),
    "",
    SIMILAR_QUESTIONS_HANDLING,
    "",
    OUTPUT_STYLE_REQUIREMENTS,
    "",
    ADMIN_FRIENDLY_OUTPUT,
    "",
    MEDUSA_GLOSSARY,
    "",
    API_CALLING_PATTERN,
    "",
    CORE_INSTRUCTIONS,
    "",
    RESPONSE_FORMAT_REQUIREMENTS,
    "",
    API_RULES,
    "",
    ERROR_RECOVERY_STRATEGIES,
    "",
    CONVERSATION_HISTORY_RULES,
    "",
    RESPONSE_FORMAT_EXAMPLES,
    "",
    `AVAILABLE TOOLS:\n${JSON.stringify(toolCatalog, null, 2)}`,
  ].join("\n");
}
