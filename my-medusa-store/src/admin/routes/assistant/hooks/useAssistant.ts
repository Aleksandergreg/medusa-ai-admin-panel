import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import { STORAGE_KEYS } from "../lib/storageKeys";
import {
  askAssistant,
  fetchAssistantConversation,
  approveAssistantValidation,
  rejectAssistantValidation,
} from "../lib/assistantApi";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";
import type { ValidationRequest } from "../types";

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
      if (!(e instanceof Error && e.name === "AbortError")) {
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
        const outcome = await approveAssistantValidation(id, editedData);
        setValidationRequest(null);
        setAnswer(outcome.answer);
        setError(outcome.kind === "failure" ? outcome.error : null);
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
      const answerMessage = await rejectAssistantValidation(id);
      setValidationRequest(null);
      setAnswer(answerMessage);
      setError(null);
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
