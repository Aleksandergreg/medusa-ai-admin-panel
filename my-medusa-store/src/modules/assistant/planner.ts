import { McpTool, ChartType } from "./types";
import { env, stripJsonFences, safeParseJSON } from "./utils";
import { getCombinedPrompt } from "./prompts";

export async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: unknown; tool_result: unknown }[],
  modelName: string = "gemini-2.5-flash",
  wantsChart: boolean = false,
  chartType: ChartType = "bar"
): Promise<{
  action: "call_tool" | "final_answer";
  tool_name?: string;
  tool_args?: unknown;
  answer?: string;
}> {
  // Deterministic CI fallback to avoid external LLM dependency and flakiness
  try {
    const ciMode = process.env.ASSISTANT_PLANNER_MODE === "ci";
    if (ciMode) {
      // Default: do nothing fancy
      return {
        action: "final_answer",
        answer:
          "CI mode active: this prompt does not match pre-defined routes.",
      };
    }
  } catch {
    // fallthrough to live LLM below if CI routing fails
  }
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  // Import GoogleGenAI here to avoid module resolution issues
  const { GoogleGenAI } = await import("@google/genai");

  const toolCatalog = tools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.input_schema ?? undefined,
  }));

  const chartDirective = wantsChart
    ? `The user wants a chart visualization. When providing your final answer:
- Call tools that return arrays of data with numeric values (e.g., order counts, revenue amounts, product quantities)
- Prefer data grouped by time periods (dates, months, years) or categories for meaningful charts
- The system will automatically convert your data response into a ${chartType} chart
- Focus on retrieving data that can be visualized effectively in chart format`
    : "Do NOT include any chart/graph JSON. Provide concise text only. If data is needed, call the right tool.";

  // Get the combined prompt for all specializations
  const Prompt = getCombinedPrompt(wantsChart);

  // STATIC CONTENT (sent once as system message)
  const systemMessage =
    `${Prompt}\n\n` +
    `Decide the next step based on the user's goal and the tool-call history.\n` +
    "Do only what the user asks for and respond with nothing else but that" +
    `Actions: 'call_tool' or 'final_answer'.\n\n` +
    `1) If you need information or must perform an action, choose 'call_tool'.\n` +
    `2) If you have enough information, choose 'final_answer' and summarize succinctly.\n\n` +
    `${chartDirective}\n\n` +
    `CRITICAL RESPONSE FORMAT REQUIREMENTS:\n` +
    `- YOU MUST ALWAYS return ONLY a valid JSON object, nothing else\n` +
    `- NEVER include markdown code fences like \`\`\`json or \`\`\`markdown around your response\n` +
    `- NEVER include any text before or after the JSON object\n` +
    `- When you output {"action":"final_answer"}, the 'answer' value MUST be formatted as GitHub-Flavored Markdown (GFM)\n` +
    `- Use short paragraphs, bullet lists, bold key IDs, and code fences for JSON or commands within the answer string\n` +
    `- Do not include raw HTML in the answer\n\n` +
    `CRITICAL API RULES:\n` +
    `- Always check tool schema carefully before making calls\n` +
    `- If a tool call fails, analyze the error and adjust your approach\n` +
    `ERROR RECOVERY STRATEGIES:\n` +
    `- If product search by exact title fails, try partial keyword search\n` +
    `- If variant creation fails with "options" error, ensure options is an object not array\n` +
    `- If variant creation fails with "prices" error, include prices array in every variant\n` +
    `- If JSON parsing fails, ensure your response is valid JSON without extra text\n\n` +
    `Always retrieve real data via the most relevant tool (Admin* list endpoints or custom tools).\n\n` +
    `RESPONSE FORMAT EXAMPLES:\n` +
    `For tool call: {"action":"call_tool","tool_name":"openapi.execute","tool_args":{"operationId":"AdminGetProducts"}}\n` +
    `For final answer: {"action":"final_answer","answer":"Here are your products:\\n\\n- **Product 1**: Description here\\n- **Product 2**: Another description"}\n\n` +
    `AVAILABLE TOOLS:\n${JSON.stringify(toolCatalog, null, 2)}`;

  // DYNAMIC CONTENT (changes each loop)
  const userMessage = [
    `User's goal: ${userPrompt}`,
    history.length > 0
      ? `Previous actions taken:\n${JSON.stringify(history, null, 2)}`
      : "No previous actions taken.",
    `What should I do next?\n\nIMPORTANT: Respond with ONLY a valid JSON object. Do not wrap it in markdown code fences. Do not include any text before or after the JSON.`,
  ].join("\n\n");

  const ai = new GoogleGenAI({ apiKey });

  const result = await ai.models.generateContent({
    model: modelName,
    contents: [
      {
        role: "user",
        parts: [{ text: systemMessage }],
      },
      {
        role: "model",
        parts: [
          {
            text: "I understand. I'm ready to help with your e-commerce platform. I'll analyze your request and decide whether to call a tool or provide a final answer. Please provide the current situation.",
          },
        ],
      },
      {
        role: "user",
        parts: [{ text: userMessage }],
      },
    ],
  });

  const text = result.text;
  if (!text) throw new Error("LLM returned empty response");

  // Try to parse robustly first
  let parsed = safeParseJSON(text);

  // If parsing failed, try to extract JSON from markdown code blocks
  if (!parsed) {
    // Remove markdown code fences if present
    const cleaned = text
      .replace(/```(?:json|markdown)?\s*\n?([\s\S]*?)\n?```/gi, "$1")
      .trim();
    parsed = safeParseJSON(cleaned);

    // If still no valid JSON, try to find the first JSON object
    if (!parsed) {
      const jsonMatch = cleaned.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
      if (jsonMatch) {
        parsed = safeParseJSON(jsonMatch[0]);
      }
    }
  }

  if (parsed && typeof parsed === "object" && "action" in parsed) {
    return parsed as {
      action: "call_tool" | "final_answer";
      tool_name?: string;
      tool_args?: unknown;
      answer?: string;
    };
  }

  // As a last resort, treat the raw response as a final answer
  console.warn(
    "LLM response was not in expected JSON format. Treating as final answer."
  );
  console.warn(
    "Raw response:",
    text.substring(0, 200) + (text.length > 200 ? "..." : "")
  );

  // Clean up any markdown formatting before using as fallback answer
  const cleanedAnswer = stripJsonFences(String(text)).trim();
  return {
    action: "final_answer",
    answer: cleanedAnswer,
  };
}