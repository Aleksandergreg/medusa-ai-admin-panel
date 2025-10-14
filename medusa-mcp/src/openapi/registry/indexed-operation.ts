import { Operation } from "./types";
import { tokenize } from "./tokenizer";

export type TokenizedField = {
    field: "operationId" | "summary" | "description" | "path" | "tags";
    original: string;
    tokens: string[];
    tokenSet: Set<string>;
    firstIndex: Map<string, number>;
};

export type TokenizedFields = TokenizedField[];

export type IndexedOperation = Operation & {
    tokenized: TokenizedFields;
    normalizedOperationId: string;
};

export function buildIndexedOperation(operation: Operation): IndexedOperation {
    const tokenized = tokenizeOperation(operation);
    const normalizedOperationId =
        tokenized.find((entry) => entry.field === "operationId")?.tokens.join(
            ""
        ) ?? "";

    return {
        ...operation,
        tokenized,
        normalizedOperationId
    };
}

function tokenizeOperation(op: Operation): TokenizedFields {
    const entries: TokenizedFields = [];
    const pushField = (
        field: TokenizedField["field"],
        value: string | string[] | undefined
    ): void => {
        if (!value) {
            return;
        }
        const original = Array.isArray(value) ? value.join(" ") : value;
        const tokens = tokenize(original, { preserveStopwords: true });
        const tokenSet = new Set(tokens);
        const firstIndex = new Map<string, number>();
        tokens.forEach((token, index) => {
            if (!firstIndex.has(token)) {
                firstIndex.set(token, index);
            }
        });
        entries.push({ field, original, tokens, tokenSet, firstIndex });
    };

    pushField("operationId", op.operationId);
    pushField("summary", op.summary);
    pushField("description", op.description);
    pushField("path", op.path);
    if (op.tags && op.tags.length) {
        pushField("tags", op.tags);
    }

    return entries;
}
