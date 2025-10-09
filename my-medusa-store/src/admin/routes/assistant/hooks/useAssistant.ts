import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import { STORAGE_KEYS } from "../lib/storageKeys";
import { askAssistant, fetchAssistantConversation } from "../lib/assistantApi";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

type ValidationRequest = {
  id: string;
  operationId: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
};

type ValidationExecutionResult = {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
  [k: string]: unknown;
};

type ValidationApproveResponse = {
  status?: "approved" | "failed";
  error?: string;
  result?: ValidationExecutionResult;
  [k: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isValidationExecutionResult = (
  value: unknown
): value is ValidationExecutionResult => {
  if (!isRecord(value)) {
    return false;
  }

  const isError = (value as { isError?: unknown }).isError;
  if (isError !== undefined && typeof isError !== "boolean") {
    return false;
  }

  if ("content" in value) {
    const content = (value as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return false;
    }
    if (
      !content.every((entry) => {
        if (!isRecord(entry)) {
          return false;
        }
        const { type, text } = entry as {
          type?: unknown;
          text?: unknown;
        };
        if (type !== undefined && typeof type !== "string") {
          return false;
        }
        if (text !== undefined && typeof text !== "string") {
          return false;
        }
        return true;
      })
    ) {
      return false;
    }
  }

  return true;
};

const isValidationApproveResponse = (
  value: unknown
): value is ValidationApproveResponse => {
  if (!isRecord(value)) {
    return false;
  }

  if ("status" in value) {
    const status = (value as { status?: unknown }).status;
    if (
      status !== undefined &&
      (typeof status !== "string" ||
        (status !== "approved" && status !== "failed"))
    ) {
      return false;
    }
  }

  if ("error" in value) {
    const error = (value as { error?: unknown }).error;
    if (error !== undefined && typeof error !== "string") {
      return false;
    }
  }

  if ("result" in value) {
    const result = (value as { result?: unknown }).result;
    if (result !== undefined && !isValidationExecutionResult(result)) {
      return false;
    }
  }

  return true;
};

const extractResultText = (
  result?: ValidationExecutionResult | null
): string | null => {
  if (!result?.content || !Array.isArray(result.content)) {
    return null;
  }

  for (const entry of result.content) {
    if (
      entry &&
      typeof entry === "object" &&
      entry.type === "text" &&
      typeof entry.text === "string"
    ) {
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
  return `## ❗ Action Failed\n\n${trimmed}\n\nYou can adjust the request details and ask me to try again, or provide a new prompt if you want to take a different approach.`;
};

export function useAssistant() {
  // persisted user prefs + prompt
  const [prompt, setPrompt] = useLocalStorageState<string>(
    STORAGE_KEYS.prompt,
    ""
  );

  const [history, setHistory] = useState<ConversationEntry[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationRequest, setValidationRequest] =
    useState<ValidationRequest | null>(null);
  const abortController = useRef<AbortController | null>(null);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();

    setLoading(true);
    fetchAssistantConversation(controller.signal)
      .then((conversation) => {
        if (!isActive) {
          return;
        }
        setHistory(conversation.history);
        const latestAssistant = [...conversation.history]
          .reverse()
          .find((entry) => entry.role === "assistant");
        setAnswer(latestAssistant?.content ?? null);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isActive) {
          return;
        }
        const message =
          (e as Error)?.message ?? "Failed to load assistant conversation";
        if (message !== "Unauthorized") {
          setError(message);
        } else {
          setError(null);
        }
        setHistory([]);
        setAnswer(null);
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });

    return () => {
      isActive = false;
      controller.abort();
    };
  }, []);

  const canSubmit = useMemo(
    () => prompt.trim().length > 0 && !loading,
    [prompt, loading]
  );

  const ask = useCallback(async () => {
    if (!canSubmit) return;

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }

    if (abortController.current) {
      abortController.current.abort();
    }
    abortController.current = new AbortController();
    const signal = abortController.current.signal;

    const previousHistory = history;
    const optimisticHistory: ConversationEntry[] = [
      ...history,
      { role: "user", content: trimmedPrompt },
    ];

    setHistory(optimisticHistory);
    setLoading(true);
    setAnswer(null);
    setError(null);

    try {
      const payload = {
        prompt: trimmedPrompt,
      } as const;

      const res = await askAssistant(payload, signal);
      if (signal.aborted) {
        return;
      }

      setHistory(res.history);
      setAnswer(res.answer);

      // Check if response includes validation request
      if (res.validationRequest) {
        setValidationRequest(res.validationRequest);
      }
    } catch (e: unknown) {
      setHistory(previousHistory);
      if (e instanceof Error && e.name === "AbortError") {
        console.log("Request aborted");
      } else {
        setError((e as Error)?.message ?? "Unknown error");
      }
    } finally {
      setLoading(false);
      abortController.current = null;
    }
  }, [canSubmit, prompt, history]);

  const cancel = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
    }
  }, []);

  const approveValidation = useCallback(
    async (id: string, editedData?: Record<string, unknown>) => {
      try {
        setLoading(true);
        const payload = { id, approved: true, editedData };
        console.log("Sending approval payload:", payload);

        const res = await fetch("/admin/assistant/validation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });

        let parsed: unknown = null;
        try {
          parsed = await res.json();
        } catch (parseError) {
          console.error("Failed to parse validation response:", parseError);
        }

        if (!isValidationApproveResponse(parsed)) {
          console.error("Invalid validation response shape:", parsed);
          const fallback =
            isRecord(parsed) && typeof parsed.error === "string"
              ? parsed.error
              : "Unexpected response from validation service.";
          setValidationRequest(null);
          const failureAnswer = formatFailureAnswer(fallback);
          setAnswer(failureAnswer);
          setError(fallback);
          return;
        }

        const json = parsed;
        console.log("Approval response:", json);

        const executionError = deriveExecutionError(json);
        if (!res.ok || json.status !== "approved" || executionError) {
          const reason =
            executionError ??
            json.error ??
            "The assistant could not complete the operation.";

          setValidationRequest(null);
          const failureAnswer = formatFailureAnswer(reason);
          setAnswer(failureAnswer);
          setError(reason);
          return;
        }

        // Clear validation request and update with result
        setValidationRequest(null);
        setError(null);

        // Format success message in a user-friendly way
        const successMessage = `## ✅ Action Completed Successfully\n\nYour request has been processed and the changes have been applied to your store.\n\nYou can now continue with your next task or ask me for help with something else.`;

        setAnswer(successMessage);
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to approve operation");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const rejectValidation = useCallback(async (id: string) => {
    try {
      setLoading(true);
      const res = await fetch("/admin/assistant/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id, approved: false }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to reject validation");
      }

      setValidationRequest(null);

      const cancelMessage = `## ❌ Action Cancelled\n\nNo changes were made to your store. The operation has been cancelled as requested.\n\nFeel free to ask me to do something else!`;

      setAnswer(cancelMessage);
    } catch (e: unknown) {
      setError((e as Error)?.message ?? "Failed to reject operation");
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setAnswer(null);
    setError(null);
    setPrompt("");
    setHistory([]);
    setValidationRequest(null);
    cancel(); // Cancel any ongoing request when clearing
  }, [setPrompt, cancel]);

  return {
    // state
    prompt,
    setPrompt,
    history,

    answer,
    setAnswer,
    loading,
    error,
    validationRequest,

    // derived/handlers
    canSubmit,
    ask,
    clear,
    cancel,
    approveValidation,
    rejectValidation,
  } as const;
}
