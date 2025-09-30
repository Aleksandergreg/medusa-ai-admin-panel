import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import { STORAGE_KEYS } from "../lib/storageKeys";
import { askAssistant, fetchAssistantSession } from "../lib/assistantApi";
import type { ChartSpec } from "../ChartRenderer";
import type { ConversationEntry } from "../../../../modules/assistant/lib/types";

export function useAssistant() {
  // persisted user prefs + prompt
  const [prompt, setPrompt] = useLocalStorageState<string>(
    STORAGE_KEYS.prompt,
    ""
  );
  const [wantsChart, setWantsChart] = useLocalStorageState<boolean>(
    STORAGE_KEYS.wantsChart,
    false
  );
  const [chartType, setChartType] = useLocalStorageState<"bar" | "line">(
    STORAGE_KEYS.chartType,
    "bar"
  );
  const [chartTitle, setChartTitle] = useLocalStorageState<string>(
    STORAGE_KEYS.chartTitle,
    ""
  );
  const [sessionId, setSessionId] = useLocalStorageState<string | null>(
    STORAGE_KEYS.sessionId,
    null
  );

  const [history, setHistory] = useState<ConversationEntry[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [chart, setChart] = useState<ChartSpec | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const lastFetchedSession = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      lastFetchedSession.current = null;
      setHistory([]);
      setAnswer(null);
      setChart(null);
      return;
    }

    if (lastFetchedSession.current === sessionId) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    setLoading(true);
    fetchAssistantSession(sessionId, controller.signal)
      .then((session) => {
        if (!isActive) {
          return;
        }
        lastFetchedSession.current = session.sessionId;
        setHistory(session.history);
        setChart(null);
        const latestAssistant = [...session.history]
          .reverse()
          .find((entry) => entry.role === "assistant");
        setAnswer(latestAssistant?.content ?? null);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isActive) {
          return;
        }
        lastFetchedSession.current = null;
        const message = (e as Error)?.message ?? "Failed to load assistant session";
        if (message && message !== "Session not found") {
          setError(message);
        } else {
          setError(null);
        }
        setHistory([]);
        setAnswer(null);
        setChart(null);
        setSessionId(null);
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
  }, [sessionId, setSessionId]);

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
    setChart(null);
    setError(null);

    try {
      const trimmedTitle = chartTitle.trim();
      const payload = {
        prompt: trimmedPrompt,
        wantsChart,
        chartType,
        ...(trimmedTitle ? { chartTitle: trimmedTitle } : {}),
        ...(sessionId ? { sessionId } : {}),
      } as const;

      const res = await askAssistant(payload, signal);
      if (signal.aborted) {
        return;
      }

      const resolvedSessionId = res.sessionId ?? sessionId ?? null;

      setHistory(res.history);
      setAnswer(res.answer);
      setChart(res.chart ?? null);
      setSessionId(resolvedSessionId);
      lastFetchedSession.current = resolvedSessionId;
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
  }, [
    canSubmit,
    prompt,
    wantsChart,
    chartType,
    chartTitle,
    sessionId,
    history,
  ]);

  const cancel = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
    }
  }, []);

  const clear = useCallback(() => {
    lastFetchedSession.current = null;
    setAnswer(null);
    setChart(null);
    setError(null);
    setPrompt("");
    setHistory([]);
    setSessionId(null);
    cancel(); // Cancel any ongoing request when clearing
  }, [setPrompt, setSessionId, cancel]);

  return {
    // state
    prompt,
    setPrompt,
    wantsChart,
    setWantsChart,
    chartType,
    setChartType,
    chartTitle,
    setChartTitle,
    sessionId,
    setSessionId,
    history,

    answer,
    setAnswer,
    chart,
    setChart,
    loading,
    error,

    // derived/handlers
    canSubmit,
    ask,
    clear,
    cancel,
  } as const;
}
