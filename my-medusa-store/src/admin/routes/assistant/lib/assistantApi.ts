import { z } from "zod";
import type { AssistantResponse, AssistantConversation } from "../types";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

const ConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const ValidationRequestSchema = z.object({
  id: z.string(),
  operationId: z.string(),
  method: z.string(),
  path: z.string(),
  args: z.record(z.unknown()),
  bodyFieldEnums: z.record(z.array(z.string())).optional(),
  bodyFieldReadOnly: z.array(z.string()).optional(),
  resourcePreview: z.record(z.unknown()).optional(),
});

const ValidationExecutionResultSchema = z
  .object({
    isError: z.boolean().optional(),
    content: z
      .array(
        z
          .object({
            type: z.string().optional(),
            text: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const ValidationApproveResponseSchema = z
  .object({
    status: z.enum(["approved", "failed"]).optional(),
    error: z.string().optional(),
    result: ValidationExecutionResultSchema.optional(),
  })
  .passthrough();

const AssistantResponseSchema = z.object({
  response: z.string().default(""),
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
  validationRequest: ValidationRequestSchema.optional(),
});

const AssistantConversationSchema = z.object({
  history: z.array(ConversationEntrySchema).default([]),
  updatedAt: z.string().nullish().default(null),
});

const SUCCESS_MESSAGE =
  `## ✅ Action Completed Successfully\n\n` +
  `Your request has been processed and the changes have been applied to your store.\n\n` +
  `You can now continue with your next task or ask me for help with something else.`;

const CANCEL_MESSAGE =
  `## ❌ Action Cancelled\n\n` +
  `No changes were made to your store. The operation has been cancelled as requested.\n\n` +
  `Feel free to ask me to do something else!`;

type ValidationExecutionResult = z.infer<typeof ValidationExecutionResultSchema>;
type ValidationApproveResponse = z.infer<typeof ValidationApproveResponseSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractResultText = (
  result?: ValidationExecutionResult | null
): string | null => {
  if (!result?.content) {
    return null;
  }

  for (const entry of result.content) {
    if (entry?.type === "text" && typeof entry.text === "string") {
      return entry.text;
    }
  }

  return null;
};

const deriveExecutionError = (
  response: ValidationApproveResponse
): string | null => {
  const explicitError =
    typeof response.error === "string" && response.error.trim().length
      ? response.error.trim()
      : null;

  if (explicitError) {
    return explicitError;
  }

  if (!response.result?.isError) {
    return null;
  }

  const rawText = extractResultText(response.result);
  if (!rawText) {
    return "The assistant could not complete the operation.";
  }

  const normalized = rawText.replace(/^Error:\s*/i, "").trim();
  return normalized.length
    ? normalized
    : "The assistant could not complete the operation.";
};

const formatFailureAnswer = (reason: string): string => {
  const trimmed = reason.trim();
  return (
    "## ❗ Action Failed\n\n" +
    `${trimmed}\n\n` +
    "You can adjust the request details and ask me to try again, or provide a new prompt if you want to take a different approach."
  );
};

export type ValidationApprovalOutcome =
  | { kind: "success"; answer: string }
  | { kind: "failure"; answer: string; error: string };

export type AskPayload = {
  prompt: string;
};

export async function askAssistant(
  payload: AskPayload,
  signal?: AbortSignal
): Promise<AssistantResponse> {
  const res = await fetch("/admin/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    answer: parsed.data.response,
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
    validationRequest: parsed.data.validationRequest,
  };
}

export async function fetchAssistantConversation(
  signal?: AbortSignal
): Promise<AssistantConversation> {
  const res = await fetch("/admin/assistant", {
    method: "GET",
    credentials: "include",
    signal,
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json && json.error
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  const parsed = AssistantConversationSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid response from server :(");
  }

  return {
    history: parsed.data.history as ConversationEntry[],
    updatedAt: parsed.data.updatedAt ? new Date(parsed.data.updatedAt) : null,
  };
}

export async function approveAssistantValidation(
  id: string,
  editedData?: Record<string, unknown>
): Promise<ValidationApprovalOutcome> {
  const res = await fetch("/admin/assistant/validation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id, approved: true, editedData }),
  });

  let parsedJson: unknown = null;
  try {
    parsedJson = await res.json();
  } catch {
    // ignore parse failure; handled below
  }

  const parsed = parsedJson
    ? ValidationApproveResponseSchema.safeParse(parsedJson)
    : null;

  if (!parsed?.success) {
    const fallback =
      isRecord(parsedJson) && typeof parsedJson.error === "string"
        ? parsedJson.error
        : "Unexpected response from validation service.";
    return {
      kind: "failure",
      answer: formatFailureAnswer(fallback),
      error: fallback,
    };
  }

  const response = parsed.data;
  const executionError = deriveExecutionError(response);

  if (!res.ok || response.status !== "approved" || executionError) {
    const reason =
      executionError ??
      response.error ??
      (isRecord(parsedJson) && typeof parsedJson.error === "string"
        ? parsedJson.error
        : "The assistant could not complete the operation.");

    return {
      kind: "failure",
      answer: formatFailureAnswer(reason),
      error: reason,
    };
  }

  return {
    kind: "success",
    answer: SUCCESS_MESSAGE,
  };
}

export async function rejectAssistantValidation(id: string): Promise<string> {
  const res = await fetch("/admin/assistant/validation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ id, approved: false }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      json && typeof json.error === "string"
        ? String(json.error)
        : `Request failed with ${res.status}`;
    throw new Error(msg);
  }

  return CANCEL_MESSAGE;
}
