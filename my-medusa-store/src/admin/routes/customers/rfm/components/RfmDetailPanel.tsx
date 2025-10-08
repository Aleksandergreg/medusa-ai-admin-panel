"use client";
import type { RfmScore, SegmentDefinition } from "../lib/rfmApi";

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

function describeSegment(
  score: RfmScore,
  segments?: SegmentDefinition[]
) {
  if (!segments?.length) {
    return null;
  }
  const match = segments.find(
    (segment) =>
      segment.id === score.rfm_segment || segment.label === score.rfm_segment
  );
  if (!match) {
    return null;
  }
  return match.description ?? null;
}

export type RfmDetailPanelProps = {
  score: RfmScore | null;
  segments?: SegmentDefinition[];
  reportingCurrency?: string;
};

export function RfmDetailPanel({
  score,
  segments,
  reportingCurrency
}: RfmDetailPanelProps) {
  if (!score) {
    return (
      <section className="rounded-md border bg-ui-bg-base p-4 text-sm text-ui-fg-subtle">
        Select a customer row to see their details.
      </section>
    );
  }

  const segmentDescription = describeSegment(score, segments);

  return (
    <section className="grid gap-3 rounded-md border bg-ui-bg-base p-4">
      <header className="grid gap-1">
        <span className="text-xs uppercase tracking-wide text-ui-fg-subtle">
          Customer
        </span>
        <h2 className="text-lg font-semibold text-ui-fg-base">
          {score.customer_id}
        </h2>
      </header>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-ui-fg-subtle">
            Segment
          </span>
          <span className="text-base font-medium text-ui-fg-base">
            {score.rfm_segment}
          </span>
          {segmentDescription && (
            <p className="text-sm text-ui-fg-subtle">{segmentDescription}</p>
          )}
        </div>

        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-ui-fg-subtle">
            RFM Index
          </span>
          <span className="text-2xl font-semibold text-ui-fg-base">
            {score.rfm_index}
          </span>
          <span className="text-sm text-ui-fg-subtle">
            R/F/M scores: {score.r_score} / {score.f_score} / {score.m_score}
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-ui-fg-subtle">
            Recency
          </span>
          <span className="text-base text-ui-fg-base">
            {score.recency_days === null
              ? "No completed orders"
              : `${score.recency_days} days`}
          </span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-ui-fg-subtle">
            Frequency (365d)
          </span>
          <span className="text-base text-ui-fg-base">
            {score.frequency_365d}
          </span>
        </div>
        <div className="grid gap-1">
          <span className="text-xs uppercase tracking-wide text-ui-fg-subtle">
            Monetary (365d)
          </span>
          <span className="text-base text-ui-fg-base">
            {formatCurrency(score.monetary_365d_cents, reportingCurrency)}
          </span>
        </div>
      </div>

      <footer className="text-xs text-ui-fg-subtle">
        Last calculated: {new Date(score.calculated_at).toLocaleString()}
      </footer>
    </section>
  );
}
