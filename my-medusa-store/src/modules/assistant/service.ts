import {
  ContainerRegistrationKeys,
  MedusaService,
} from "@medusajs/framework/utils";
import type { Knex } from "knex";
import { askAgent } from "./agent/ask";
import { AssistantModuleOptions, DEFAULT_ASSISTANT_OPTIONS } from "./config";
import {
  ConversationEntry,
  ConversationRow,
  HistoryEntry,
  MessageRow,
  PromptInput,
  PromptResult,
  ValidationRequest,
} from "./lib/types";
import { generateId } from "./utils/idGenerator";

const CONVERSATION_TABLE = "conversation_session";
const MESSAGE_TABLE = "conversation_message";

// Type guard for validation request
function isValidationRequest(data: unknown): data is ValidationRequest {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    "operationId" in data &&
    "method" in data &&
    "path" in data &&
    "args" in data
  );
}

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;

  constructor(
    container: Record<string, unknown>,
    options: AssistantModuleOptions = DEFAULT_ASSISTANT_OPTIONS
  ) {
    super(container, options);
    this.config = { ...DEFAULT_ASSISTANT_OPTIONS, ...options };
  }

  private get db(): Knex {
    return this.__container__[ContainerRegistrationKeys.PG_CONNECTION] as Knex;
  }

  async prompt(input: PromptInput): Promise<PromptResult> {
    const trimmedPrompt = input.prompt?.trim();
    if (!trimmedPrompt) {
      throw new Error("Missing prompt");
    }

    const actorId = input.actorId?.trim();
    if (!actorId) {
      throw new Error("Missing actor identifier");
    }

    const existing = await this.getConversation(actorId);
    const existingHistory = existing?.history ?? [];

    const userTurn: ConversationEntry = {
      role: "user",
      content: trimmedPrompt,
    };

    const workingHistory = [...existingHistory, userTurn];

    const agentResult = await askAgent(
      {
        prompt: trimmedPrompt,
        history: this.toAgentHistory(workingHistory),
      },
      { config: this.config }
    );

    const answer = agentResult.answer?.trim()
      ? agentResult.answer
      : "Sorry, I could not find an answer to your question.";

    const finalHistory: ConversationEntry[] = [
      ...workingHistory,
      { role: "assistant", content: answer },
    ];

    const updatedAt = new Date();
    await this.persistConversation(actorId, finalHistory, updatedAt);

    // Check if there's validation data in agent result
    const validationData = isValidationRequest(agentResult.data)
      ? agentResult.data
      : undefined;

    return {
      answer,
      history: finalHistory,
      updatedAt,
      validationRequest: validationData,
    };
  }

  async getConversation(actorId: string): Promise<{
    history: ConversationEntry[];
    updatedAt: Date | null;
  } | null> {
    const resolvedActorId = actorId?.trim();
    if (!resolvedActorId) {
      return null;
    }

    const session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: resolvedActorId })
      .orderBy("updated_at", "desc")
      .first();

    if (!session) {
      return null;
    }

    const messages = await this.db<MessageRow>(MESSAGE_TABLE)
      .where({ session_id: session.id })
      .orderBy("created_at", "asc");

    const history: ConversationEntry[] = [];
    for (const message of messages) {
      history.push({ role: "user", content: message.question });
      if (message.answer) {
        history.push({ role: "assistant", content: message.answer });
      }
    }

    return {
      history,
      updatedAt: session.updated_at ? new Date(session.updated_at) : null,
    };
  }

  private toAgentHistory(entries: ConversationEntry[]): HistoryEntry[] {
    return entries.map((entry) => ({
      tool_name: "conversation",
      tool_args: { role: entry.role },
      tool_result: { content: entry.content },
    }));
  }

  private async persistConversation(
    actorId: string,
    history: ConversationEntry[],
    updatedAt: Date
  ): Promise<void> {
    // Get or create session
    let session = await this.db<ConversationRow>(CONVERSATION_TABLE)
      .where({ actor_id: actorId })
      .first();

    if (!session) {
      const sessionId = generateId("sess");
      await this.db(CONVERSATION_TABLE).insert({
        id: sessionId,
        actor_id: actorId,
        created_at: updatedAt,
        updated_at: updatedAt,
      });
      session = {
        id: sessionId,
        actor_id: actorId,
        created_at: updatedAt,
        updated_at: updatedAt,
      };
    } else {
      // Update session timestamp
      await this.db(CONVERSATION_TABLE)
        .where({ id: session.id })
        .update({ updated_at: updatedAt });
    }

    // Extract the last question-answer pair from history
    // (We only persist the new exchange, not the entire history)
    if (history.length >= 2) {
      const lastQuestion = history[history.length - 2];
      const lastAnswer = history[history.length - 1];

      if (lastQuestion.role === "user" && lastAnswer.role === "assistant") {
        const messageId = generateId("msg");
        await this.db(MESSAGE_TABLE).insert({
          id: messageId,
          session_id: session.id,
          question: lastQuestion.content,
          answer: lastAnswer.content,
          created_at: updatedAt,
        });
      }
    }
  }
}

export default AssistantModuleService;
