import { useEffect, useState } from "react";
import {
  AssistantNpsResponseRow,
  AssistantNpsListParams,
  fetchAssistantNpsResponses,
} from "../lib/assistantApi";

export function useAssistantNpsRecent(
  limit = 10,
  options: Omit<AssistantNpsListParams, "limit"> = {}
) {
  const [responses, setResponses] = useState<AssistantNpsResponseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskLabel = options.taskLabel;

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    setLoading(true);
    fetchAssistantNpsResponses(
      { limit, taskLabel },
      controller.signal
    )
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
  }, [limit, taskLabel]);

  return { responses, loading, error } as const;
}
