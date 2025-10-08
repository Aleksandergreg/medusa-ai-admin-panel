"use client";
import { useMemo } from "react";
import type { RfmScore } from "../lib/rfmApi";

export type PaginationControls = {
  limit: number;
  offset: number;
  setLimit: (limit: number) => void;
  setOffset: (offset: number) => void;
};

export type RfmTableProps = {
  scores: RfmScore[];
  loading: boolean;
  count: number;
  onSelect?: (score: RfmScore) => void;
  selectedCustomerId?: string | null;
  pagination: PaginationControls;
  reportingCurrency?: string;
};

function formatCurrency(
  cents: number,
  currency: string | undefined
): string {
  const code = currency?.toUpperCase() || "USD";
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

function formatRecency(days: number | null): string {
  if (days === null) {
    return "—";
  }
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "1 day";
  }
  return `${days} days`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function RfmTable({
  scores,
  loading,
  count,
  onSelect,
  selectedCustomerId,
  pagination,
  reportingCurrency
}: RfmTableProps) {
  const start = useMemo(() => pagination.offset + 1, [pagination.offset]);
  const end = useMemo(
    () => Math.min(pagination.offset + pagination.limit, count),
    [pagination.limit, pagination.offset, count]
  );

  const handlePrev = () => {
    const nextOffset = Math.max(0, pagination.offset - pagination.limit);
    pagination.setOffset(nextOffset);
  };

  const handleNext = () => {
    const nextOffset = pagination.offset + pagination.limit;
    if (nextOffset >= count) {
      return;
    }
    pagination.setOffset(nextOffset);
  };

  return (
    <section className="grid gap-3">
      <div className="overflow-auto border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-ui-bg-subtle text-left">
              <th className="p-2">Customer</th>
              <th className="p-2">Segment</th>
              <th className="p-2">Index</th>
              <th className="p-2">R / F / M</th>
              <th className="p-2">Recency</th>
              <th className="p-2">Frequency</th>
              <th className="p-2">Monetary (365d)</th>
              <th className="p-2">Calculated</th>
            </tr>
          </thead>
          <tbody>
            {scores.length === 0 && (
              <tr>
                <td className="p-3 text-center" colSpan={8}>
                  {loading ? "Loading scores…" : "No scores found."}
                </td>
              </tr>
            )}
            {scores.map((score) => {
              const isSelected = score.customer_id === selectedCustomerId;
              return (
                <tr
                  key={score.customer_id}
                  className={`border-t transition-colors cursor-pointer ${
                    isSelected ? "bg-ui-bg-subtle" : "hover:bg-ui-bg-subtle"
                  }`}
                  onClick={() => onSelect?.(score)}
                >
                  <td className="p-2 whitespace-nowrap font-medium">
                    {score.customer_id}
                  </td>
                  <td className="p-2 whitespace-nowrap">{score.rfm_segment}</td>
                  <td className="p-2 font-semibold">{score.rfm_index}</td>
                  <td className="p-2">
                    <span className="font-mono">
                      {score.r_score}/{score.f_score}/{score.m_score}
                    </span>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {formatRecency(score.recency_days)}
                  </td>
                  <td className="p-2">{score.frequency_365d}</td>
                  <td className="p-2 whitespace-nowrap">
                    {formatCurrency(
                      score.monetary_365d_cents,
                      reportingCurrency
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {formatDate(score.calculated_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          {count > 0 ? (
            <span>
              Showing {start}-{end} of {count}
            </span>
          ) : (
            <span>No results</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1">
            <span className="text-ui-fg-subtle text-xs uppercase tracking-wide">
              Rows
            </span>
            <select
              className="border-ui-border-base bg-ui-bg-base rounded-md border px-2 py-1"
              value={pagination.limit}
              onChange={(event) =>
                pagination.setLimit(Number(event.target.value) || 25)
              }
            >
              {[25, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              disabled={pagination.offset === 0 || loading}
              className="rounded-md border px-2 py-1 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={pagination.offset + pagination.limit >= count || loading}
              className="rounded-md border px-2 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
