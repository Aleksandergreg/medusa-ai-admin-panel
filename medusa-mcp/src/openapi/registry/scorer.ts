import { IndexedOperation, TokenizedField } from "./indexed-operation";
import { normalizeToken, STOPWORDS } from "./tokenizer";

const FIELD_WEIGHTS: Record<TokenizedField["field"], number> = {
    operationId: 3,
    summary: 2.5,
    description: 1,
    path: 1,
    tags: 2
};

const STOPWORD_TOKEN_WEIGHT = 0.25;
const PROXIMITY_WINDOW_FACTOR = 2;
const PROXIMITY_MIN_TOKENS = 2;
const DESCRIPTION_LENGTH_THRESHOLD = 30;
const DESCRIPTION_LENGTH_PENALTY_STEP = 0.01;
const DESCRIPTION_LENGTH_PENALTY_CAP = 0.3;

export type ScoreDetail = {
    field: TokenizedField["field"];
    matches: number;
    tokens: number;
    weight: number;
    proximityBoost?: boolean;
    prefixBoost?: boolean;
    lengthPenalty?: number;
};

export type QueryContext = {
    tokens: string[];
    nonStopTokens: string[];
    compactQuery: string;
};

export function buildQueryContext(
    tokens: string[],
    rawQuery: string
): QueryContext {
    const nonStopTokens = tokens.filter((token) => !STOPWORDS.has(token));
    return {
        tokens,
        nonStopTokens,
        compactQuery: normalizeToken(rawQuery)
    };
}

export function scoreOperation(
    op: IndexedOperation,
    ctx: QueryContext
): { score: number; details: ScoreDetail[] } {
    const { tokens, nonStopTokens, compactQuery } = ctx;
    const tokenized = op.tokenized;

    let total = 0;
    const details: ScoreDetail[] = [];

    for (const entry of tokenized) {
        const fieldTokens = entry.tokens;
        if (!fieldTokens.length) {
            continue;
        }
        const tokenSet = entry.tokenSet;
        let matches = 0;
        let weightedMatches = 0;

        for (const token of tokens) {
            if (!tokenSet.has(token)) {
                continue;
            }
            matches += 1;
            const weight = STOPWORDS.has(token) ? STOPWORD_TOKEN_WEIGHT : 1;
            weightedMatches += weight;
        }

        if (!matches) {
            continue;
        }

        const baseWeight = FIELD_WEIGHTS[entry.field] ?? 1;
        let fieldScore = weightedMatches * baseWeight;
        let proximityBoost = false;
        let prefixBoost = false;
        let lengthPenalty: number | undefined;

        if (nonStopTokens.length >= PROXIMITY_MIN_TOKENS) {
            const positions: number[] = [];
            for (const token of nonStopTokens) {
                const idx = entry.firstIndex.get(token);
                if (idx !== undefined) {
                    positions.push(idx);
                }
            }
            if (positions.length === nonStopTokens.length) {
                const span = Math.max(...positions) - Math.min(...positions);
                if (span <= nonStopTokens.length * PROXIMITY_WINDOW_FACTOR) {
                    fieldScore *= 1.2;
                    proximityBoost = true;
                }
            }
        }

        if (entry.field === "operationId") {
            const normalizedId = op.normalizedOperationId;
            if (compactQuery && normalizedId.startsWith(compactQuery)) {
                fieldScore *= 1.15;
                prefixBoost = true;
            }
        }

        if (
            entry.field === "description" &&
            fieldTokens.length > DESCRIPTION_LENGTH_THRESHOLD
        ) {
            const over = fieldTokens.length - DESCRIPTION_LENGTH_THRESHOLD;
            const penalty = Math.min(
                DESCRIPTION_LENGTH_PENALTY_CAP,
                over * DESCRIPTION_LENGTH_PENALTY_STEP
            );
            if (penalty > 0) {
                fieldScore *= 1 - penalty;
                lengthPenalty = penalty;
            }
        }

        total += fieldScore;
        details.push({
            field: entry.field,
            matches,
            tokens: fieldTokens.length,
            weight: fieldScore,
            proximityBoost,
            prefixBoost,
            lengthPenalty
        });
    }

    if (!details.length) {
        return { score: 0, details: [] };
    }

    const normalizedScore = total / Math.max(tokens.length, 1);
    return { score: normalizedScore, details };
}
