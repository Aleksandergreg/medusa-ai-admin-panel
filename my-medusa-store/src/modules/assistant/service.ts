import { ContainerRegistrationKeys, MedusaService } from "@medusajs/framework/utils";
import type { Knex } from "knex";
import { randomUUID } from "node:crypto";
import { askAgent } from "./agent/ask";
import {
  AssistantModuleOptions,
  DEFAULT_ASSISTANT_OPTIONS,
} from "./config";
import {
  ChartType,
  ConversationEntry,
  HistoryEntry,
} from "./lib/types";

type PromptInput = {
  prompt: string;
  sessionId?: string;
  wantsChart?: boolean;
  chartType?: ChartType;
  chartTitle?: string;
};

type PromptResult = {
  answer: string;
  chart: unknown | null;
  history: ConversationEntry[];
  sessionId: string;
};

type ConversationSessionRow = {
  session_id: string;
  history: unknown;
  updated_at: Date | string | null;
};

const CONVERSATION_TABLE = "conversation_session";

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

    const existing = input.sessionId
      ? await this.getSession(input.sessionId)
      : null;

    const sessionId = existing?.sessionId ?? randomUUID();
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
        wantsChart: input.wantsChart,
        chartType: input.chartType,
        chartTitle: input.chartTitle,
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

    await this.persistSession(sessionId, finalHistory);

    return {
      answer,
      chart: agentResult.chart ?? null,
      history: finalHistory,
      sessionId,
    };
  }

  async getSession(sessionId: string | null | undefined): Promise<
    | { sessionId: string; history: ConversationEntry[]; updatedAt: Date | null }
    | null
  > {
    if (!sessionId) {
      return null;
    }

    const row = await this.db<ConversationSessionRow>(CONVERSATION_TABLE)
      .where({ session_id: sessionId })
      .first();

    if (!row) {
      return null;
    }

    return {
      sessionId: row.session_id,
      history: this.deserializeHistory(row.history),
      updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    };
  }

  private deserializeHistory(raw: unknown): ConversationEntry[] {
    if (!raw) {
      return [];
    }

    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized: ConversationEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const role = (item as { role?: unknown }).role;
      const content = (item as { content?: unknown }).content;

      if (
        (role === "user" || role === "assistant") &&
        typeof content === "string"
      ) {
        normalized.push({ role, content });
      }
    }

    return normalized;
  }

  private toAgentHistory(entries: ConversationEntry[]): HistoryEntry[] {
    return entries.map((entry) => ({
      tool_name: "conversation",
      tool_args: { role: entry.role },
      tool_result: { content: entry.content },
    }));
  }

  private async persistSession(
    sessionId: string,
    history: ConversationEntry[]
  ): Promise<void> {
    const payload = {
      session_id: sessionId,
      history: JSON.stringify(history),
      updated_at: new Date(),
    };

    await this.db(CONVERSATION_TABLE)
      .insert(payload)
      .onConflict("session_id")
      .merge({ history: payload.history, updated_at: payload.updated_at });
  }
}

export default AssistantModuleService;
