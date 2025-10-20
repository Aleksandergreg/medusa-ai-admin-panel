import { useEffect, useState } from "react";
import {
  AssistantNpsMetrics,
  fetchAssistantNpsMetrics,
} from "../lib/assistantApi";

export function useAssistantNpsMetrics() {
  const [metrics, setMetrics] = useState<AssistantNpsMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    const controller = new AbortController();
    setLoading(true);
    fetchAssistantNpsMetrics(controller.signal)
      .then((data) => {
        if (!isActive) {
          return;
        }
        setMetrics(data);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isActive) {
          return;
        }
        const message =
          (e as Error)?.message ?? "Failed to load ANPS metrics";
        setError(message);
        setMetrics(null);
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

  return { metrics, loading, error } as const;
}
