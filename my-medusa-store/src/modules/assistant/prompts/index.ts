/**
 * Main entry point for combined domain-specific prompts
 * Assembles all base prompt components into the foundation prompt
 */
import { BASE_ROLE } from "./prompts-parts/base-role";
import { getContextAwareness } from "./prompts-parts/context-awareness";
import { SIMILAR_QUESTIONS_HANDLING } from "./prompts-parts/similar-questions-handling";
import { OUTPUT_STYLE_REQUIREMENTS } from "./prompts-parts/output-style";
import { MEDUSA_GLOSSARY } from "./prompts-parts/medusa-glossary";
import { API_CALLING_PATTERN } from "./prompts-parts/api-calling-pattern";

export function getCombinedPrompt(): string {
  return [
    BASE_ROLE,
    getContextAwareness(),
    "",
    SIMILAR_QUESTIONS_HANDLING,
    "",
    OUTPUT_STYLE_REQUIREMENTS,
    "",
    MEDUSA_GLOSSARY,
    "",
    API_CALLING_PATTERN,
  ].join("\n");
}
