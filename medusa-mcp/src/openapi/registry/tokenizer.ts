const RAW_STOPWORDS = [
    "a",
    "about",
    "an",
    "and",
    "for",
    "from",
    "get",
    "gets",
    "give",
    "list",
    "lists",
    "me",
    "of",
    "or",
    "show",
    "shows",
    "tell",
    "the",
    "to",
    "what",
    "when",
    "where",
    "which",
    "with"
];

export const STOPWORDS = new Set(RAW_STOPWORDS);

export function normalizeToken(token: string): string {
    return token.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function tokenize(
    value: unknown,
    opts?: { preserveStopwords?: boolean }
): string[] {
    if (value === null || value === undefined) {
        return [];
    }
    const text = String(value)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .toLowerCase();
    const tokens = text
        .split(/\s+/)
        .map((segment) => normalizeToken(segment))
        .filter(Boolean);
    if (opts?.preserveStopwords) {
        return tokens;
    }
    const filtered = tokens.filter((segment) => !STOPWORDS.has(segment));
    return filtered.length ? filtered : tokens;
}

export function tokenizeQuery(query: string): {
    tokens: string[];
    normalized: string;
    original: string;
} {
    const normalized = query.toLowerCase().trim();
    const tokens = normalized
        .split(/\s+/)
        .map((segment) => normalizeToken(segment))
        .filter(Boolean);
    return {
        tokens: tokens.length ? tokens : [normalizeToken(query)],
        normalized,
        original: query
    };
}
