import { AssistantModuleOptions } from "../config";
import { FALLBACK_MESSAGE } from "../lib/plan-normalizer";
import { HistoryEntry } from "../lib/types";
import {
  ensureMarkdownMinimum,
  extractToolJsonPayload,
} from "../lib/utils";

const MAX_TOOL_EVENTS = 8;
const MAX_ARGS_LENGTH = 600;
const MAX_RESULT_LENGTH = 1800;

const SKIP_TOOL_NAMES = new Set(["assistant.note", "conversation"]);

const truncate = (text: string, limit: number): string => {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + "\n... (truncated)";
};

const safeStringify = (value: unknown, limit: number): string => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return truncate(value, limit);
  }
  try {
    return truncate(JSON.stringify(value, null, 2), limit);
  } catch {
    return truncate(String(value), limit);
  }
};

const formatHistoryDigest = (history: HistoryEntry[]): string => {
  const relevant = history.filter(
    (entry) => !SKIP_TOOL_NAMES.has(entry.tool_name ?? "")
  );
  const recent = relevant.slice(-MAX_TOOL_EVENTS);

  const sections: string[] = [];

  recent.forEach((entry, index) => {
    if (entry.tool_name === "assistant.summary") {
      const source =
        (entry.tool_args?.source_tool as string | undefined) ?? "unknown";
      const summary =
        (entry.tool_result as { assistant_summary?: unknown })
          ?.assistant_summary ?? entry.tool_result;

      sections.push(
        [
          `Summary ${index + 1} (source: ${source})`,
          safeStringify(summary, MAX_RESULT_LENGTH),
        ].join("\n")
      );
      return;
    }

    if (entry.tool_name?.startsWith("assistant.")) {
      return;
    }

    const argsText = safeStringify(entry.tool_args, MAX_ARGS_LENGTH);
    const payload =
      extractToolJsonPayload(entry.tool_result) ?? entry.tool_result;
    const resultText = safeStringify(payload, MAX_RESULT_LENGTH);

    const sectionParts = [
      `Step ${index + 1}: ${entry.tool_name}`,
      argsText ? `Args:\n${argsText}` : "",
      resultText ? `Result:\n${resultText}` : "",
    ].filter(Boolean);

    if (sectionParts.length) {
      sections.push(sectionParts.join("\n\n"));
    }
  });

  return sections.join("\n\n");
};

const extractText = (response: any): string | undefined => {
  try {
    if (!response) return undefined;

    const attempts = [
      response,
      response?.response,
      response?.candidates?.[0],
      response?.response?.candidates?.[0],
    ];

    for (const candidate of attempts) {
      const text = candidate?.text;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
      if (typeof text === "function") {
        const computed = text();
        if (typeof computed === "string" && computed.trim()) {
          return computed;
        }
      }

      const parts = candidate?.content?.parts ?? candidate?.parts;
      if (Array.isArray(parts)) {
        const joined = parts
          .map((part: any) => part?.text)
          .filter((t: unknown): t is string => typeof t === "string")
          .join("")
          .trim();
        if (joined) {
          return joined;
        }
      }
    }
  } catch {
    // ignore and fall through
  }
  return undefined;
};

export async function craftFinalAnswer(params: {
  prompt: string;
  planAnswer?: string;
  history: HistoryEntry[];
  config: AssistantModuleOptions;
}): Promise<string> {
  const { config, prompt, planAnswer } = params;
  const baseAnswer = ensureMarkdownMinimum(
    planAnswer && planAnswer.trim().length ? planAnswer : FALLBACK_MESSAGE
  );

  const finalModel = config.finalModelName ?? config.modelName;

  // If no dedicated final model is configured, reuse the planner answer.
  if (!finalModel || finalModel === config.modelName) {
    return baseAnswer;
  }

  if (!config.geminiApiKey) {
    return baseAnswer;
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  const historyDigest = formatHistoryDigest(params.history);

  const userSections = [
    `User request:\n${prompt}`,
    historyDigest
      ? `Tool evidence to ground the answer:\n${historyDigest}`
      : "No tool calls were executed. Rely on existing knowledge cautiously.",
    planAnswer && planAnswer.trim()
      ? `Planner draft answer to refine:\n${planAnswer.trim()}`
      : "The planner did not provide a draft answer. Produce a grounded response if possible.",
    "Craft the final response for the user. Only rely on tool evidence above. If information is missing, clearly state what else is needed. Format the response in GitHub-Flavored Markdown with concise sections and bullet points.",
  ];

  const result = await ai.models.generateContent({
    model: finalModel,
    contents: [
      {
        role: "user",
        parts: [{ text: userSections.join("\n\n") }],
      },
    ],
    config: {
      systemInstruction: {
        parts: [
          {
            text: [
              "You are the final response writer for the Medusa admin assistant.",
              "Use the provided tool evidence to compose accurate, grounded answers.",
              "Never invent data that is not supported by the evidence.",
              "Respond using GitHub-Flavored Markdown headings, bullet points, and code blocks when helpful.",
            ].join("\n"),
          },
        ],
      },
    },
  });

  const responseText = extractText(result);
  if (!responseText || !responseText.trim()) {
    return baseAnswer;
  }

  return ensureMarkdownMinimum(responseText.trim());
}
