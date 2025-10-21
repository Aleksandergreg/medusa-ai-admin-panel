import { ConversationEntry, HistoryEntry, MessageRow } from "../lib/types";

/**
 * Mapper for conversation data transformations.
 * Handles conversion between different data representations.
 */
export class ConversationMapper {
  /**
   * Convert conversation entries to agent-compatible history format.
   */
  static toAgentHistory(entries: ConversationEntry[]): HistoryEntry[] {
    return entries.map((entry) => ({
      tool_name: "conversation",
      tool_args: { role: entry.role },
      tool_result: { content: entry.content },
    }));
  }

  /**
   * Convert database message rows to conversation entries.
   */
  static messagesToConversationEntries(
    messages: MessageRow[]
  ): ConversationEntry[] {
    const history: ConversationEntry[] = [];

    for (const message of messages) {
      if (message.question) {
        history.push({ role: "user", content: message.question });
      }
      if (message.answer) {
        history.push({ role: "assistant", content: message.answer });
      }
    }

    return history;
  }

  /**
   * Generate a title from the first user message.
   * Truncates to 50 characters if needed.
   */
  static generateTitle(history: ConversationEntry[]): string {
    const firstUserMessage = history.find((h) => h.role === "user");

    if (!firstUserMessage) {
      return "New Conversation";
    }

    if (firstUserMessage.content.length > 50) {
      return firstUserMessage.content.substring(0, 50) + "...";
    }

    return firstUserMessage.content;
  }

  /**
   * Extract the last question-answer pair from conversation history.
   * Returns null if the last two entries are not a valid Q&A pair.
   */
  static extractLastQAPair(
    history: ConversationEntry[]
  ): { question: string; answer: string } | null {
    if (history.length < 2) {
      return null;
    }

    const lastQuestion = history[history.length - 2];
    const lastAnswer = history[history.length - 1];

    if (lastQuestion.role === "user" && lastAnswer.role === "assistant") {
      return {
        question: lastQuestion.content,
        answer: lastAnswer.content,
      };
    }

    return null;
  }
}
