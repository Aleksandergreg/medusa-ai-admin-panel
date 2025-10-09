/**
 * Generates human-friendly success messages using AI summarization
 */

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

    // Use the assistant service to generate a natural response.
    // A temporary actorId is used to ensure this summarization step doesn't get saved to the user's main chat history.
    const result = await assistantService.prompt({
      prompt,
      actorId: `${actorId}_summary`,
    });

    if (result.answer && !result.answer.includes("Sorry")) {
      return result.answer;
    }
  } catch (err) {
    console.error("Failed to generate AI summary:", err);
  }

  return null;
};
