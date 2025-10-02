import { McpTool, InitialOperation } from "../lib/types";
import { stripJsonFences, safeParseJSON } from "../lib/utils";
import { buildSystemMessage } from "../prompts/system-message";
import { AssistantModuleOptions } from "../config";

export async function planNextStepWithGemini(
  userPrompt: string,
  tools: McpTool[],
  history: { tool_name: string; tool_args: unknown; tool_result: unknown }[],
  modelName: string = "gemini-2.5-flash",
  initialOperations: InitialOperation[] = [],
  config?: AssistantModuleOptions
): Promise<{
  action: "call_tool" | "final_answer";
  tool_name?: string;
  tool_args?: unknown;
  answer?: string;
}> {
  // Deterministic CI fallback to avoid external LLM dependency and flakiness
  try {
    const ciMode =
      config?.plannerMode === "ci" ||
      process.env.ASSISTANT_PLANNER_MODE === "ci";
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
  const apiKey = config?.geminiApiKey;
  if (!apiKey) throw new Error("Gemini API key is not configured");

  // Import GoogleGenAI here to avoid module resolution issues
  const { GoogleGenAI } = await import("@google/genai");

  // Build the system message from modular prompt components
  const systemMessage = buildSystemMessage(tools);

  // DYNAMIC CONTENT (changes each loop)
  const userMessage = [
    `User's goal: ${userPrompt}`,
    history.length > 0
      ? `Previous actions taken:\n${JSON.stringify(history, null, 2)}`
      : "No previous actions taken.",
    initialOperations.length > 0
      ? `Initial openapi.search suggestions:\n${initialOperations
          .map((op) => {
            const tagString = op.tags?.length
              ? ` [tags: ${op.tags.join(", ")}]`
              : "";
            const summary = op.summary ? ` — ${op.summary}` : "";
            return `- ${op.operationId} (${op.method.toUpperCase()} ${
              op.path
            })${tagString}${summary}`;
          })
          .join("\n")}`
      : "No openapi.search suggestions provided.",
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
