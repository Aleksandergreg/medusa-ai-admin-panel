/**
 * Assembles the complete system message for the planner
 */
import { getCombinedPrompt } from "./index";
import { CORE_INSTRUCTIONS } from "./system-message-parts/instructions";
import {
  RESPONSE_FORMAT_REQUIREMENTS,
  RESPONSE_FORMAT_EXAMPLES,
} from "./system-message-parts/response-format";
import { API_RULES } from "./system-message-parts/api-rules";
import { ERROR_RECOVERY_STRATEGIES } from "./system-message-parts/error-recovery";
import { CONVERSATION_HISTORY_RULES } from "./system-message-parts/conversation-history";
import type { McpTool } from "../lib/types";

export function buildSystemMessage(tools: McpTool[]): string {
  const basePrompt = getCombinedPrompt();

  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.input_schema ?? undefined,
  }));

  return [
    basePrompt,
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
