"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchRfmConfig,
  listRfmScores,
  type RfmListQuery,
  type RfmConfig,
  type RfmScore
} from "../lib/rfmApi";

export type RfmFilters = {
  segment?: string | null;
  minIndex?: number | null;
  maxRecencyDays?: number | null;
  customerId?: string | null;
  limit: number;
  offset: number;
};

type RfmState = {
  scores: RfmScore[];
  count: number;
  loading: boolean;
  error: string | null;
  config: RfmConfig | null;
};

const DEFAULT_FILTERS: RfmFilters = {
  segment: null,
  minIndex: null,
  maxRecencyDays: null,
  customerId: null,
  limit: 25,
  offset: 0
};

function toQuery(filters: RfmFilters): RfmListQuery {
  const query: RfmListQuery = {
    limit: filters.limit,
    offset: filters.offset
  };

  if (filters.segment) {
    query.segment = filters.segment;
  }
  if (typeof filters.minIndex === "number") {
    query.min_index = filters.minIndex;
  }
  if (typeof filters.maxRecencyDays === "number") {
    query.max_recency_days = filters.maxRecencyDays;
  }
  if (filters.customerId) {
    query.customer_id = filters.customerId.trim();
  }
  return query;
}

export function useRfmScores() {
  const [filters, setFilters] = useState<RfmFilters>(DEFAULT_FILTERS);
  const filtersRef = useRef<RfmFilters>(DEFAULT_FILTERS);
  const [state, setState] = useState<RfmState>({
    scores: [],
    count: 0,
    loading: false,
    error: null,
    config: null
  });

  const abortRef = useRef<AbortController | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const config = await fetchRfmConfig();
      setState((prev) => ({ ...prev, config }));
    } catch (error) {
      console.error("Failed to load RFM config", error);
    }
  }, []);

  const load = useCallback(async (override?: Partial<RfmFilters>) => {
    const nextFilters = { ...filtersRef.current, ...(override ?? {}) };
    filtersRef.current = nextFilters;
    setFilters(nextFilters);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const response = await listRfmScores(
        toQuery(nextFilters),
        controller.signal
      );
      setState((prev) => ({
        ...prev,
        scores: response.data,
        count: response.count,
        loading: false,
        error: null
      }));
    } catch (error) {
      if ((error as any)?.name === "AbortError") {
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }, []);

  const refresh = useCallback(() => load({ offset: 0 }), [load]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const pagination = useMemo(
    () => ({
      limit: filters.limit,
      offset: filters.offset,
      setLimit: (limit: number) => load({ limit, offset: 0 }),
      setOffset: (offset: number) => load({ offset })
    }),
    [filters.limit, filters.offset, load]
  );

  return {
    scores: state.scores,
    count: state.count,
    loading: state.loading,
    error: state.error,
    config: state.config,
    filters,
    setFilters: (updater: (prev: RfmFilters) => RfmFilters) =>
      setFilters((prev) => updater(prev)),
    load,
    refresh,
    pagination
  };
}
