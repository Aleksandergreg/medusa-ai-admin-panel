/**
 * Output style requirements for final answers
 */
export const OUTPUT_STYLE_REQUIREMENTS = `OUTPUT STYLE REQUIREMENTS:
- When giving your final answer, write using GitHub-Flavored Markdown INSIDE the JSON response only (i.e., as the value of the 'answer' field when {"action":"final_answer"}).
- Never output Markdown outside the JSON object. The top-level response must always be a single JSON object.
- Prefer concise bullet points and clear sections in the 'answer' string.
- Bold important identifiers (like order IDs, cart IDs, and customer emails).
- Use backticked code blocks for JSON or CLI snippets when appropriate (inside the 'answer' string only).
- Avoid raw HTML.`;
