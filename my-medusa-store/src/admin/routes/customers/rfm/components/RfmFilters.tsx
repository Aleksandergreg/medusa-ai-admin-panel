"use client";
import type { SegmentDefinition } from "../lib/rfmApi";

export type DraftFilters = {
  segment: string;
  minIndex: string;
  maxRecencyDays: string;
  customerId: string;
};

export type RfmFiltersProps = {
  draft: DraftFilters;
  segments?: SegmentDefinition[];
  reportingCurrency?: string;
  onDraftChange: (draft: DraftFilters) => void;
  onApply: () => void;
  onReset: () => void;
  loading: boolean;
};

function renderOption(segment: SegmentDefinition) {
  return (
    <option key={segment.id} value={segment.id}>
      {segment.label}
    </option>
  );
}

export function RfmFilters({
  draft,
  segments,
  reportingCurrency,
  onDraftChange,
  onApply,
  onReset,
  loading
}: RfmFiltersProps) {
  const handleChange = (patch: Partial<DraftFilters>) => {
    onDraftChange({ ...draft, ...patch });
  };

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-medium text-ui-fg-base">Filters</h2>
        {reportingCurrency && (
          <span className="text-xs text-ui-fg-subtle">
            Reporting currency: {reportingCurrency.toUpperCase()}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-sm">
          <span className="text-ui-fg-subtle">Segment</span>
          <select
            className="border-ui-border-base bg-ui-bg-base rounded-md border px-2 py-1"
            value={draft.segment}
            onChange={(event) => handleChange({ segment: event.target.value })}
          >
            <option value="">All segments</option>
            {segments?.map(renderOption)}
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-ui-fg-subtle">Min RFM Index</span>
          <input
            type="number"
            min={0}
            max={100}
            placeholder="e.g. 70"
            className="border-ui-border-base bg-ui-bg-base rounded-md border px-2 py-1"
            value={draft.minIndex}
            onChange={(event) => handleChange({ minIndex: event.target.value })}
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-ui-fg-subtle">Max Recency (days)</span>
          <input
            type="number"
            min={0}
            placeholder="e.g. 60"
            className="border-ui-border-base bg-ui-bg-base rounded-md border px-2 py-1"
            value={draft.maxRecencyDays}
            onChange={(event) =>
              handleChange({ maxRecencyDays: event.target.value })
            }
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-ui-fg-subtle">Customer ID</span>
          <input
            type="text"
            placeholder="customer id"
            className="border-ui-border-base bg-ui-bg-base rounded-md border px-2 py-1"
            value={draft.customerId}
            onChange={(event) => handleChange({ customerId: event.target.value })}
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={loading}
          className={`rounded-md px-3 py-2 text-sm font-medium text-white ${
            loading
              ? "bg-ui-border-disabled cursor-not-allowed"
              : "bg-ui-bg-interactive"
          }`}
        >
          {loading ? "Loading…" : "Apply filters"}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="rounded-md px-3 py-2 text-sm border bg-ui-bg-base text-ui-fg-base"
        >
          Reset
        </button>
      </div>
    </section>
  );
}
