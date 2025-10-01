/**
 * Critical response format requirements for the assistant
 */
export const RESPONSE_FORMAT_REQUIREMENTS = `CRITICAL RESPONSE FORMAT REQUIREMENTS:
- YOU MUST ALWAYS return ONLY a valid JSON object, nothing else
- NEVER include markdown code fences like \`\`\`json or \`\`\`markdown around your response
- NEVER include any text before or after the JSON object
- When you output {"action":"final_answer"}, the 'answer' value MUST be formatted as GitHub-Flavored Markdown (GFM)
- Use short paragraphs, bullet lists, bold key IDs, and code fences for JSON or commands within the answer string
- Do not include raw HTML in the answer`;

export const RESPONSE_FORMAT_EXAMPLES = `RESPONSE FORMAT EXAMPLES:
For tool call: {"action":"call_tool","tool_name":"openapi.execute","tool_args":{"operationId":"AdminGetProducts"}}
For final answer: {"action":"final_answer","answer":"Here are your products:\\n\\n- **Product 1**: Description here\\n- **Product 2**: Another description"}`;
