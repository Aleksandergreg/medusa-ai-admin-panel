"use client";
import { useEffect, useMemo, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { Container, Heading, Text } from "@medusajs/ui";
import { useRfmScores } from "./hooks/useRfmScores";
import { RfmFilters, type DraftFilters } from "./components/RfmFilters";
import { RfmTable } from "./components/RfmTable";
import { RfmDetailPanel } from "./components/RfmDetailPanel";

const DEFAULT_DRAFT: DraftFilters = {
  segment: "",
  minIndex: "",
  maxRecencyDays: "",
  customerId: ""
};

function toDraft(filters: ReturnType<typeof useRfmScores>["filters"]): DraftFilters {
  return {
    segment: filters.segment ?? "",
    minIndex:
      typeof filters.minIndex === "number" ? String(filters.minIndex) : "",
    maxRecencyDays:
      typeof filters.maxRecencyDays === "number"
        ? String(filters.maxRecencyDays)
        : "",
    customerId: filters.customerId ?? ""
  };
}

function parseDraft(draft: DraftFilters) {
  const minRaw = draft.minIndex.trim();
  const maxRaw = draft.maxRecencyDays.trim();
  const min = minRaw === "" ? null : Number(minRaw);
  const max = maxRaw === "" ? null : Number(maxRaw);

  return {
    segment: draft.segment || null,
    minIndex: min !== null && Number.isFinite(min) ? min : null,
    maxRecencyDays: max !== null && Number.isFinite(max) ? max : null,
    customerId: draft.customerId.trim() || null
  };
}

const CustomersRfmPage = () => {
  const {
    scores,
    count,
    loading,
    error,
    config,
    filters,
    load,
    refresh,
    pagination
  } = useRfmScores();

  const [draft, setDraft] = useState<DraftFilters>(DEFAULT_DRAFT);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(filters));
  }, [filters]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const match = scores.find((score) => score.customer_id === selectedId);
    if (!match) {
      setSelectedId(null);
    }
  }, [scores, selectedId]);

  const selectedScore = useMemo(
    () => scores.find((score) => score.customer_id === selectedId) ?? null,
    [scores, selectedId]
  );

  const handleApply = () => {
    const parsed = parseDraft(draft);
    load({
      segment: parsed.segment,
      minIndex: parsed.minIndex,
      maxRecencyDays: parsed.maxRecencyDays,
      customerId: parsed.customerId,
      offset: 0
    });
  };

  const handleReset = () => {
    setDraft(DEFAULT_DRAFT);
    setSelectedId(null);
    load({
      segment: null,
      minIndex: null,
      maxRecencyDays: null,
      customerId: null,
      offset: 0
    });
  };

  const reportingCurrency = config?.reporting_currency;
  const segments = config?.segments;

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Customer RFM</Heading>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="rounded-md border px-3 py-2 text-sm text-ui-fg-base disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="px-6 py-4 grid gap-5">
        <Text size="small" className="text-ui-fg-subtle">
          Recency, frequency, and monetary scores computed nightly. Filter the
          list to identify audiences and click a customer to view their latest
          segment breakdown.
        </Text>

        <RfmFilters
          draft={draft}
          segments={segments}
          reportingCurrency={reportingCurrency}
          onDraftChange={setDraft}
          onApply={handleApply}
          onReset={handleReset}
          loading={loading}
        />

        {error && <div className="text-ui-fg-error text-sm">Error: {error}</div>}

        <RfmTable
          scores={scores}
          count={count}
          loading={loading}
          onSelect={(score) => setSelectedId(score.customer_id)}
          selectedCustomerId={selectedId}
          pagination={pagination}
          reportingCurrency={reportingCurrency}
        />

        <RfmDetailPanel
          score={selectedScore}
          segments={segments}
          reportingCurrency={reportingCurrency}
        />
      </div>
    </Container>
  );
};

export const config = defineRouteConfig({
  label: "Customer RFM",
  icon: ChartBar
});

export default CustomersRfmPage;
