import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import { STORAGE_KEYS } from "../lib/storageKeys";
import {
  askAssistant,
  fetchAssistantConversation,
  approveAssistantValidation,
  rejectAssistantValidation,
  listConversations,
  createConversation,
  deleteConversation,
  fetchConversationById,
  updateConversationTitle,
  cancelAssistantRequest,
} from "../lib/assistantApi";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";
import type { ValidationRequest, ConversationSummary } from "../types";

export function useAssistant() {
  // persisted user prefs + prompt
  const [prompt, setPrompt] = useLocalStorageState<string>(
    STORAGE_KEYS.prompt,
    ""
  );

  const [currentSessionId, setCurrentSessionId] = useLocalStorageState<
    string | null
  >(STORAGE_KEYS.currentSessionId, null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [history, setHistory] = useState<ConversationEntry[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [conversationsLoading, setConversationsLoading] = useState(false);
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

  const loadConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const convos = await listConversations();
      setConversations(convos);
    } catch (e: unknown) {
      console.error("Failed to load conversations", e);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  const handleCreateConversation = useCallback(
    async (title?: string) => {
      try {
        const newConvo = await createConversation(title);
        setCurrentSessionId(newConvo.id);
        setHistory([]);
        setAnswer(null);
        setError(null);
        setValidationRequest(null);
        await loadConversations();
        return newConvo;
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to create conversation");
        throw e;
      }
    },
    [setCurrentSessionId, loadConversations]
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
    setPrompt(""); // Clear the input after submitting

    try {
      const payload = {
        prompt: trimmedPrompt,
        sessionId: currentSessionId ?? undefined,
      };

      const res = await askAssistant(payload, signal);
      if (signal.aborted) {
        return;
      }

      setHistory(res.history);
      setAnswer(res.answer);

      if (res.sessionId) {
        setCurrentSessionId(res.sessionId);
        // If the conversation list hasn't been updated with this new session, refresh it
        if (!conversations.find((c) => c.id === res.sessionId)) {
          loadConversations();
        }
      }

      setValidationRequest(res.validationRequest ?? null);
    } catch (askError: unknown) {
      const errorMsg = (askError as Error)?.message ?? "";
      if (errorMsg.includes("Session not found")) {
        // This is the primary path for creating a new conversation.
        try {
          setCurrentSessionId(null); // Ensure we're starting fresh
          const newConvo = await handleCreateConversation();
          const retryPayload = {
            prompt: trimmedPrompt,
            sessionId: newConvo.id,
          };

          // We need to ensure the UI history is correct for the retry
          setHistory([
            ...previousHistory,
            { role: "user", content: trimmedPrompt },
          ]);

          const retryRes = await askAssistant(retryPayload, signal);
          if (signal.aborted) {
            return;
          }

          setHistory(retryRes.history);
          setAnswer(retryRes.answer);

          if (retryRes.sessionId) {
            setCurrentSessionId(retryRes.sessionId);
            loadConversations(); // We know we need to reload here
          }

          setValidationRequest(retryRes.validationRequest ?? null);
        } catch (retryError: unknown) {
          setHistory(previousHistory);
          setError((retryError as Error)?.message ?? "Unknown error");
        }
      } else {
        // It was a different error, so rollback and show it.
        setHistory(previousHistory);
        if (!(askError instanceof Error && askError.name === "AbortError")) {
          setError((askError as Error)?.message ?? "Unknown error");
        }
      }
    } finally {
      setLoading(false);
      abortController.current = null;
    }
  }, [
    canSubmit,
    prompt,
    history,
    setPrompt,
    currentSessionId,
    conversations.length,
    handleCreateConversation,
    loadConversations,
    setCurrentSessionId,
  ]);

  const cancel = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
    }
    // Also cancel on the backend
    cancelAssistantRequest(currentSessionId ?? undefined).catch((e) => {
      console.error("Failed to cancel backend request:", e);
    });
  }, [currentSessionId]);

  const approveValidation = useCallback(
    async (id: string, editedData?: Record<string, unknown>) => {
      const optimisticHistory: ConversationEntry[] = [
        ...history,
        { role: "user", content: "✓ Approved" },
      ];
      setHistory(optimisticHistory);

      try {
        setIsMutating(true);
        const outcome = await approveAssistantValidation(id, editedData);
        setHistory(outcome.history);
        setAnswer(outcome.answer);
        setValidationRequest(outcome.validationRequest ?? null);
        setError(null);
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to approve operation");
        setHistory(history); // Rollback on error
      } finally {
        setIsMutating(false);
      }
    },
    [history]
  );

  const rejectValidation = useCallback(
    async (id: string) => {
      const optimisticHistory: ConversationEntry[] = [
        ...history,
        { role: "user", content: "✗ Rejected" },
      ];
      setHistory(optimisticHistory);

      try {
        setIsMutating(true);
        const outcome = await rejectAssistantValidation(id);
        setHistory(outcome.history);
        setAnswer(outcome.answer);
        setValidationRequest(outcome.validationRequest ?? null);
        setError(null);
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to reject operation");
        setHistory(history); // Rollback on error
      } finally {
        setIsMutating(false);
      }
    },
    [history]
  );

  const handleSwitchConversation = useCallback(
    async (sessionId: string) => {
      try {
        setLoading(true);
        const conversation = await fetchConversationById(sessionId);
        setCurrentSessionId(sessionId);
        setHistory(conversation.history);
        const latestAssistant = [...conversation.history]
          .reverse()
          .find((entry) => entry.role === "assistant");
        setAnswer(latestAssistant?.content ?? null);
        setError(null);
        setValidationRequest(null);
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to load conversation");
      } finally {
        setLoading(false);
      }
    },
    [setCurrentSessionId]
  );

  const handleDeleteConversation = useCallback(
    async (sessionId: string) => {
      try {
        await deleteConversation(sessionId);

        // If we deleted the current conversation, clear it
        if (sessionId === currentSessionId) {
          setCurrentSessionId(null);
          setHistory([]);
          setAnswer(null);
          setValidationRequest(null);
        }

        await loadConversations();
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to delete conversation");
      }
    },
    [currentSessionId, setCurrentSessionId, loadConversations]
  );

  const handleRenameConversation = useCallback(
    async (sessionId: string, newTitle: string) => {
      try {
        await updateConversationTitle(sessionId, newTitle);
        await loadConversations();
      } catch (e: unknown) {
        setError((e as Error)?.message ?? "Failed to rename conversation");
      }
    },
    [loadConversations]
  );

  const clear = useCallback(() => {
    setAnswer(null);
    setError(null);
    setPrompt("");
    setHistory([]);
    setValidationRequest(null);
    cancel(); // Cancel any ongoing request when clearing
  }, [setPrompt, cancel]);

  // Load conversations on mount only
  useEffect(() => {
    loadConversations();
  }, []); // Run only once on mount

  return {
    // state
    prompt,
    setPrompt,
    history,
    conversations,
    conversationsLoading,
    currentSessionId,

    answer,
    setAnswer,
    loading,
    isMutating,
    error,
    validationRequest,

    // derived/handlers
    canSubmit,
    ask,
    clear,
    cancel,
    approveValidation,
    rejectValidation,

    // conversation management
    createConversation: handleCreateConversation,
    switchConversation: handleSwitchConversation,
    deleteConversation: handleDeleteConversation,
    renameConversation: handleRenameConversation,
    refreshConversations: loadConversations,
  } as const;
}
