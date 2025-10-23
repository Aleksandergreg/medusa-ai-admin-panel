import { AssistantModuleOptions } from "../../config";
import { HistoryEntry } from "../../lib/types";
import { summarizeStatusMessages, StatusDigest } from "./status-digest";
import { buildOperationFeedbackPrompt, buildTurnSummaryPrompt } from "./feedback-prompts";
import {
  GeminiFeedbackClient,
  GeminiFeedbackClientOptions,
} from "./gemini-feedback-client";
import {
  parseFeedbackPayload,
  toQualitativeFeedback,
} from "./feedback-parser";
import type {
  QualitativeFeedback,
  FeedbackPayload,
} from "./feedback-models";
import type { AgentNpsEvaluation, SchemaAdherenceReport } from "./types";

export type { QualitativeFeedback } from "./feedback-models";

const DEFAULT_MODEL = process.env.ASSISTANT_MODEL_NAME || "gemini-2.5-flash";

type OperationReference = {
  operationId: string;
  taskLabel: string | null;
};

const resolveClientOptions = (
  config: AssistantModuleOptions
): GeminiFeedbackClientOptions | null => {
  const apiKey = config.geminiApiKey ?? process.env.ASSISTANT_GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model =
    process.env.ASSISTANT_FEEDBACK_MODEL ?? config.modelName ?? DEFAULT_MODEL;

  return { apiKey, model };
};

const logParseFailure = (text: string, event: string): void => {
  console.warn(
    JSON.stringify({
      event,
      sample: text.trim().slice(0, 120),
    })
  );
};

const executeGeminiRequest = async (
  client: GeminiFeedbackClient,
  buildPrompt: () => string,
  parse: (raw: string) => FeedbackPayload | null,
  emptyEvent: string,
  parseFailedEvent: string
): Promise<FeedbackPayload | null> => {
  const { rawText, parsed } = await client.execute<FeedbackPayload>({
    buildPrompt,
    parseResponse: parse,
  });

  if (!rawText || !rawText.trim()) {
    console.warn(
      JSON.stringify({
        event: emptyEvent,
      })
    );
    return null;
  }

  if (!parsed) {
    logParseFailure(rawText, parseFailedEvent);
    return null;
  }

  return parsed;
};

const buildOperationPrompt = (params: {
  operationId: string;
  taskLabel: string | null;
  evaluation: AgentNpsEvaluation;
  statusMessages: StatusDigest[];
  answer?: string | null;
  relatedOperations?: OperationReference[];
  schema?: SchemaAdherenceReport | null;
}) =>
  buildOperationFeedbackPrompt({
    operationId: params.operationId,
    taskLabel: params.taskLabel,
    evaluation: params.evaluation,
    statusMessages: params.statusMessages,
    answer: params.answer,
    relatedOperations: params.relatedOperations,
    schema: params.schema ?? null,
  });

const buildTurnPrompt = (params: {
  operations: {
    operationId: string;
    taskLabel: string | null;
    evaluation: AgentNpsEvaluation;
    statuses: StatusDigest[];
  }[];
  durationMs: number;
  agentComputeMs?: number | null;
  answer?: string | null;
}) =>
  buildTurnSummaryPrompt({
    operations: params.operations,
    durationMs: params.durationMs,
    agentComputeMs: params.agentComputeMs,
    answer: params.answer,
  });

export async function generateQualitativeFeedback(params: {
  operationId: string;
  taskLabel: string | null;
  evaluation: AgentNpsEvaluation;
  history: HistoryEntry[];
  answer?: string | null;
  config: AssistantModuleOptions;
  relatedOperations?: OperationReference[];
  schemaAdherence?: SchemaAdherenceReport | null;
}): Promise<QualitativeFeedback | null> {
  const options = resolveClientOptions(params.config);
  if (!options) {
    console.warn(
      JSON.stringify({
        event: "agent_feedback.skipped",
        reason: "missing_api_key",
      })
    );
    return null;
  }

  const client = new GeminiFeedbackClient(options);
  const statusMessages = summarizeStatusMessages(
    params.history,
    params.operationId
  );

  try {
    const payload = await executeGeminiRequest(
      client,
      () =>
        buildOperationPrompt({
          operationId: params.operationId,
          taskLabel: params.taskLabel,
          evaluation: params.evaluation,
          statusMessages,
          answer: params.answer,
          relatedOperations: params.relatedOperations,
          schema: params.schemaAdherence ?? null,
        }),
      parseFeedbackPayload,
      "agent_feedback.empty_response",
      "agent_feedback.parse_failed"
    );

    if (!payload) {
      return null;
    }

    return toQualitativeFeedback(payload);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "agent_feedback.error",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return null;
  }
}

export async function generateTurnSummaryFeedback(params: {
  operations: {
    operationId: string;
    taskLabel: string | null;
    evaluation: AgentNpsEvaluation;
  }[];
  history: HistoryEntry[];
  answer?: string | null;
  config: AssistantModuleOptions;
  durationMs: number;
  agentComputeMs?: number | null;
}): Promise<QualitativeFeedback | null> {
  if (!params.operations.length) {
    return null;
  }

  const options = resolveClientOptions(params.config);
  if (!options) {
    console.warn(
      JSON.stringify({
        event: "agent_feedback.turn_skipped",
        reason: "missing_api_key",
      })
    );
    return null;
  }

  const client = new GeminiFeedbackClient(options);
  const operationsWithStatus = params.operations.map((item) => ({
    ...item,
    statuses: summarizeStatusMessages(params.history, item.operationId),
  }));

  try {
    const payload = await executeGeminiRequest(
      client,
      () =>
        buildTurnPrompt({
          operations: operationsWithStatus,
          durationMs: params.durationMs,
          agentComputeMs: params.agentComputeMs,
          answer: params.answer,
        }),
      parseFeedbackPayload,
      "agent_feedback.turn_empty_response",
      "agent_feedback.turn_parse_failed"
    );

    if (!payload) {
      return null;
    }

    return toQualitativeFeedback(payload);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "agent_feedback.turn_error",
        message: error instanceof Error ? error.message : String(error),
      })
    );
    return null;
  }
}
