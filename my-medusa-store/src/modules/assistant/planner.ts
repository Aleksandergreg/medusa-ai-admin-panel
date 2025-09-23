import { McpTool, ChartType } from "./types";
import { env, stripJsonFences, safeParseJSON } from "./utils";
import { getCombinedPrompt } from "./prompts";

type OperationSuggestion = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
};

export async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: any; tool_result: any }[],
  modelName: string = "gemini-2.5-flash",
  wantsChart: boolean = false,
  chartType: ChartType = "bar",
  initialOperations: OperationSuggestion[] = []
): Promise<{
  action: "call_tool" | "final_answer";
  tool_name?: string;
  tool_args?: any;
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

  const openApiWorkflow = `OPENAPI TOOL WORKFLOW:\n` +
    `1. Call openapi.search with action + resource + scope keywords (e.g., "count orders admin").\n` +
    `2. Review returned operationId candidates and pick the best match.\n` +
    `3. Call openapi.schema for the chosen operationId to gather required path, query, and body fields.\n` +
    `4. Execute the request with openapi.execute, filling pathParams, query, and body exactly as the schema describes.\n` +
    `5. If the execute call fails, inspect the schema again or run a refined search.\n`;

  // STATIC CONTENT (sent once as system message)
  const systemMessage =
    `${Prompt}\n\n` +
    `Decide the next step based on the user's goal and the tool-call history.\n` +
    "Do only what the user asks for and respond with nothing else but that" +
    `Actions: 'call_tool' or 'final_answer'.\n\n` +
    `1) If you need information or must perform an action, choose 'call_tool'.\n` +
    `2) If you have enough information, choose 'final_answer' and summarize succinctly.\n\n` +
    `${chartDirective}\n\n` +
    `${openApiWorkflow}\n` +
    `FINAL ANSWER FORMAT:\n` +
    `- When you output {"action":"final_answer"}, the 'answer' value MUST be formatted as GitHub-Flavored Markdown (GFM).\n` +
    `- Use short paragraphs, bullet lists, bold key IDs, and code fences for JSON or commands.\n` +
    `- Do not include raw HTML.\n\n` +
    `CRITICAL API RULES:\n` +
    `- Always check tool schema carefully before making calls\n` +
    `- If a tool call fails, analyze the error and adjust your approach\n` +
    `- If a tool response only returns IDs but you need human-friendly details, call another endpoint (e.g., AdminGetProductsId) before ending the turn` +
    `ERROR RECOVERY STRATEGIES:\n` +
    `- If product search by exact title fails, try partial keyword search\n` +
    `- If variant creation fails with "options" error, ensure options is an object not array\n` +
    `- If variant creation fails with "prices" error, include prices array in every variant\n` +
    `- If JSON parsing fails, ensure your response is valid JSON without extra text\n\n` +
    `Always retrieve real data via the most relevant tool (Admin* list endpoints or custom tools).\n` +
    `Return a single JSON object ONLY, no commentary.\n\n` +
    `JSON to call a tool: {"action":"call_tool","tool_name":"string","tool_args":object}\n` +
    `JSON for the final answer: {"action":"final_answer","answer":"string"}\n\n` +
    `AVAILABLE TOOLS:\n${JSON.stringify(toolCatalog, null, 2)}`;

  const suggestionSection = initialOperations.length
    ? `Top candidate operations from openapi.search:\n${initialOperations
        .slice(0, 8)
        .map((op, idx) => `${idx + 1}. ${op.operationId} (${op.method.toUpperCase()} ${op.path}) - ${op.summary ?? ""}`)
        .join("\n")}\n`
    : "";

  // DYNAMIC CONTENT (changes each loop)
  const userMessage = [
    `User's goal: ${userPrompt}`,
    history.length > 0
      ? `Previous actions taken:\n${JSON.stringify(history, null, 2)}`
      : "No previous actions taken.",
    suggestionSection,
    `What should I do next? Respond with ONLY the JSON object.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const ai = new (GoogleGenAI as any)({ apiKey });

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

  const text = (result as any).text;
  if (!text) throw new Error("LLM returned empty response");

  // Try to parse robustly first
  const parsed = safeParseJSON(text);
  if (parsed && typeof parsed === "object" && "action" in parsed) {
    return parsed as {
      action: "call_tool" | "final_answer";
      tool_name?: string;
      tool_args?: any;
      answer?: string;
    };
  }

  // As a last resort, treat the raw response as a final answer
  console.error(
    "Failed to parse LLM response as JSON. Falling back to final_answer."
  );
  return {
    action: "final_answer",
    answer: stripJsonFences(String(text)).trim(),
  };
}
