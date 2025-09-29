import { IndexedOperation } from "./indexed-operation";
import { ScoreDetail } from "./scorer";

type DebugFilters = {
    tags?: string[];
    methods?: string[];
    limit?: number;
};

type ScoredEntry = {
    op: IndexedOperation;
    score: number;
    details: ScoreDetail[];
};

export function logSearchInvocation(
    query: string,
    tokens: string[],
    filters?: DebugFilters
): void {
    const filterSummary = [
        filters?.tags && filters.tags.length ? `tags=${filters.tags.join("|")}` : null,
        filters?.methods && filters.methods.length
            ? `methods=${filters.methods.map((m) => m.toUpperCase()).join("|")}`
            : null,
        filters?.limit ? `limit=${filters.limit}` : null
    ]
        .filter(Boolean)
        .join(", ");
    const tokenPreview = tokens.length ? tokens.join(",") : "<empty>";
    console.log(
        `[openapi.search] query="${query}" tokens=[${tokenPreview}]${
            filterSummary ? ` filters(${filterSummary})` : ""
        }`
    );
}

export function logSearchResults(entries: ScoredEntry[], maxLines = 5): void {
    const maxLog = Math.min(entries.length, maxLines);
    for (let i = 0; i < maxLog; i++) {
        const entry = entries[i];
        const { op, score, details } = entry;
        const summary = op.summary ?? op.description ?? "";
        const detailStr = details
            .map((detail) => formatDetail(detail))
            .join(" | ");
        console.log(
            `  ${i + 1}. score=${score.toFixed(2)} ${op.operationId} [${
                op.method.toUpperCase()
            } ${op.path}]${summary ? ` :: ${summary}` : ""}${
                detailStr ? ` {${detailStr}}` : ""
            }`
        );
    }
    if (entries.length > maxLog) {
        console.log(`  ... ${entries.length - maxLog} more`);
    }
}

function formatDetail(detail: ScoreDetail): string {
    const extras: string[] = [];
    if (detail.proximityBoost) extras.push("P");
    if (detail.prefixBoost) extras.push("X");
    if (detail.lengthPenalty) {
        extras.push(`L-${detail.lengthPenalty.toFixed(2)}`);
    }
    const suffix = extras.length ? ` (${extras.join(",")})` : "";
    return `${detail.field}:${detail.matches}/${detail.tokens}@${detail.weight
        .toFixed(2)
        .replace(/\.00$/, "")}${suffix}`;
}
