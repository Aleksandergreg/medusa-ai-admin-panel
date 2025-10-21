import { useEffect, useState } from "react";
import {
  AssistantNpsResponseRow,
  fetchAssistantNpsResponses,
} from "../lib/assistantApi";

export function useAssistantNpsRecent(limit = 10) {
  const [responses, setResponses] = useState<AssistantNpsResponseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    setLoading(true);
    fetchAssistantNpsResponses(limit, controller.signal)
      .then((rows) => {
        if (!isMounted) {
          return;
        }
        setResponses(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!isMounted) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to load ANPS responses";
        setError(message);
        setResponses([]);
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [limit]);

  return { responses, loading, error } as const;
}
