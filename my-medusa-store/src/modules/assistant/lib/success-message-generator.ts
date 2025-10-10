/**
 * Generates human-friendly success messages using AI summarization
 * This function calls the AI directly without saving to the database
 */

import { askAgent } from "../agent/ask";
import type AssistantModuleService from "../service";

type OpenApiExecutionPayload = {
  status?: string;
  statusCode?: number;
  data?: Record<string, unknown>;
  [k: string]: unknown;
};

export const generateSuccessMessage = async (
  payload: OpenApiExecutionPayload | null,
  assistantService: AssistantModuleService,
  actorId: string
): Promise<string | null> => {
  try {
    const conversation = await assistantService.getConversation(actorId);
    const lastUserMessage = conversation?.history
      .slice()
      .reverse()
      .find((entry) => entry.role === "user");

    const resultData = payload?.data
      ? JSON.stringify(payload.data, null, 2)
      : "No data returned";

    const prompt = `The user's request was successfully handled.
Original request: "${lastUserMessage?.content || "An operation"}"
Result data:
\`\`\`json
${resultData}
\`\`\`
Please provide a brief, natural, human-friendly summary (2-4 sentences) of what was successfully done, highlighting only the most important details. Be conversational and concise. Start with a success emoji (e.g., ✅ or 🎉).`;

    // Call askAgent directly without saving to database
    // This bypasses the service's prompt() method which always persists conversations
    const result = await askAgent(
      {
        prompt,
        history: [], // Empty history for one-off summary generation
      },
      { config: assistantService.getConfig() }
    );

    if (result.answer && !result.answer.includes("Sorry")) {
      // Combine the AI's friendly summary with the raw JSON data
      const combinedResponse = `${result.answer}

---

**Response Data:**
\`\`\`json
${resultData}
\`\`\``;

      return combinedResponse;
    }
  } catch (err) {
    console.error("Failed to generate AI summary:", err);
  }

  return null;
};
