import { Operation } from "./types";
import { tokenize } from "./tokenizer";

export type TokenizedField = {
    field: "operationId" | "summary" | "description" | "path" | "tags";
    original: string;
    tokens: string[];
};

export type TokenizedFields = TokenizedField[];

export type IndexedOperation = Operation & {
    tokenized: TokenizedFields;
};

export function buildIndexedOperation(operation: Operation): IndexedOperation {
    return {
        ...operation,
        tokenized: tokenizeOperation(operation)
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
        entries.push({ field, original, tokens });
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
