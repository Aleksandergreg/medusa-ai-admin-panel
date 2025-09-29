import { useCallback, useMemo, useRef, useState } from "react";
import { useLocalStorageState } from "../../../hooks/useLocalStorageState";
import { STORAGE_KEYS } from "../lib/storageKeys";
import { askAssistant } from "../lib/assistantApi";
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

  const [history, setHistory] = useLocalStorageState<ConversationEntry[]>(
    STORAGE_KEYS.history,
    []
  );

  // derived/ephemeral state
  const [answer, setAnswer] = useLocalStorageState<string | null>(
    STORAGE_KEYS.answer,
    null
  );
  const [chart, setChart] = useLocalStorageState<ChartSpec | null>(
    STORAGE_KEYS.chart,
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const canSubmit = useMemo(
    () => prompt.trim().length > 0 && !loading,
    [prompt, loading]
  );

  const ask = useCallback(async () => {
    if (!canSubmit) return;

    abortController.current = new AbortController();
    const signal = abortController.current.signal;

    setLoading(true);
    setAnswer(null);
    setChart(null);
    setError(null);

    const currentHistory = [
      ...history,
      { role: "user", content: prompt },
    ] as ConversationEntry[];
    setHistory(currentHistory);

    try {
      const payload = {
        prompt,
        wantsChart,
        chartType,
        ...(chartTitle.trim() ? { chartTitle: chartTitle.trim() } : {}),
        history: currentHistory,
      } as const;

      const res = await askAssistant(payload, signal);
      setAnswer(res.answer ?? "");
      setChart((res.chart as ChartSpec) ?? null);
      setHistory([
        ...currentHistory,
        { role: "assistant", content: res.answer ?? "" },
      ]);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") {
        console.log("Request aborted");
        // Do not set error state for AbortError
      } else {
        setError((e as Error)?.message ?? "Unknown error");
      }
    } finally {
      setLoading(false);
      abortController.current = null;
    }
  }, [canSubmit, prompt, wantsChart, chartType, chartTitle, history]);

  const cancel = useCallback(() => {
    if (abortController.current) {
      abortController.current.abort();
    }
  }, []);

  const clear = useCallback(() => {
    setAnswer(null);
    setChart(null);
    setError(null);
    setPrompt("");
    setHistory([]);
    cancel(); // Cancel any ongoing request when clearing
  }, [setPrompt, setAnswer, setChart, setHistory, cancel]);

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