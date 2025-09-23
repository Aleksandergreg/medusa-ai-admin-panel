// Utility functions for reducing OpenAPI GET responses into grouped counts.
// Supports array extraction, multi-level groupBy with array expansion tokens (token[]),
// fallback groupBy paths, and simple normalization strategies.

export type Normalizer = (v: string) => string;

export interface ReduceOptions {
    arrayPath: string; // path to the array in the response (e.g. "orders" or "data.items")
    groupByPath?: string; // primary groupBy path (may contain [] for expansion e.g. "shipping_methods[].name")
    fallbackGroupBy?: string[]; // alternative groupBy paths if primary yields no values
    normalize?: "lower-trim" | "none"; // normalization strategy
    topN?: number; // number of top groups to return (default 10)
}

export interface ReduceResultGroup {
    key: string;
    count: number;
    percent: number;
}

export interface ReduceResult {
    arrayPath: string;
    groupByPathUsed?: string;
    groups: ReduceResultGroup[]; // all groups sorted desc by count
    top: ReduceResultGroup[]; // top N
    total: number; // total array length
    missing: number; // number of items with no group key extracted
    multiValued: boolean; // true if some items contributed multiple group keys
    incomplete: boolean; // true if response indicates pagination not fully retrieved
    note?: string; // optional informational note
}

// Split a dotted path respecting [] tokens (simple implementation)
function tokenize(path: string): string[] {
    return path
        .split(".")
        .map((p) => p.trim())
        .filter(Boolean);
}

// Resolve a simple (non [] expanding) path.
function resolvePath(root: unknown, path: string): unknown {
    if (!path) {
        return root;
    }
    const tokens = tokenize(path);
    let cur: Record<string, unknown> | undefined =
        typeof root === "object" && root !== null
            ? (root as Record<string, unknown>)
            : undefined;
    for (const t of tokens) {
        if (cur == null) {
            return undefined;
        }
        const next = cur[t];
        cur =
            typeof next === "object" && next !== null
                ? (next as Record<string, unknown>)
                : (next as unknown as Record<string, unknown>);
    }
    return cur;
}

// Expand a path which may include expansion tokens: segment[] meaning iterate over array at segment.
// Example: shipping_methods[].shipping_option.name => For each item.shipping_methods (array), for each element, take shipping_option.name
export function extractExpandedValues(obj: unknown, path: string): unknown[] {
    if (!path) {
        return [obj];
    }
    const tokens = tokenize(path);
    let current: unknown[] = [obj];
    for (const raw of tokens) {
        const isArrayExpand = raw.endsWith("[]");
        const key = isArrayExpand ? raw.slice(0, -2) : raw;
        const next: unknown[] = [];
        for (const c of current) {
            if (c == null) {
                continue;
            }
            const container =
                typeof c === "object" && c !== null
                    ? (c as Record<string, unknown>)
                    : undefined;
            const val: unknown = key && container ? container[key] : c;
            if (isArrayExpand) {
                if (Array.isArray(val)) {
                    for (const item of val) {
                        next.push(item);
                    }
                }
            } else {
                next.push(val);
            }
        }
        current = next;
        if (!current.length) {
            break;
        }
    }
    return current;
}

function buildNormalizer(kind?: ReduceOptions["normalize"]): Normalizer {
    if (kind === "lower-trim") {
        return (v: string) => v.toLowerCase().trim();
    }
    return (v: string) => v; // none
}

// Main reduce logic.
export function reduceResponse(
    response: unknown,
    opts: ReduceOptions
): ReduceResult {
    const { arrayPath, groupByPath, fallbackGroupBy = [], topN = 10 } = opts;
    const normalizer = buildNormalizer(opts.normalize);

    const arrUnknown = resolvePath(response, arrayPath);
    if (!Array.isArray(arrUnknown)) {
        throw new Error(`arrayPath '${arrayPath}' did not resolve to an array`);
    }
    const arr = arrUnknown as unknown[];

    const candidateGroupPaths = [groupByPath, ...fallbackGroupBy].filter(
        (p): p is string => !!p && p.length > 0
    );

    let usedPath: string | undefined;
    const multiValueFlags: boolean[] = [];
    const counts = new Map<string, number>();
    let missing = 0;

    for (const path of candidateGroupPaths) {
        // Try this path.
        counts.clear();
        missing = 0;
        multiValueFlags.length = 0;

        for (const item of arr) {
            const rawValues = extractExpandedValues(item, path);
            const atomicValues: string[] = [];
            for (const v of rawValues) {
                if (v === null || v === undefined) {
                    continue;
                }
                if (
                    typeof v === "string" ||
                    typeof v === "number" ||
                    typeof v === "boolean"
                ) {
                    atomicValues.push(String(v));
                } else if (typeof v === "object") {
                    const vo = v as Record<string, unknown>;
                    if (typeof vo.name === "string") {
                        atomicValues.push(String(vo.name));
                    } else if (typeof vo.id === "string") {
                        atomicValues.push(String(vo.id));
                    } else {
                        atomicValues.push(JSON.stringify(v));
                    }
                }
            }

            if (!atomicValues.length) {
                missing += 1;
                continue;
            }
            if (atomicValues.length > 1) {
                multiValueFlags.push(true);
            }
            for (const a of atomicValues) {
                const k = normalizer(a);
                counts.set(k, (counts.get(k) ?? 0) + 1);
            }
        }

        // If we obtained at least one key we accept this path.
        if (counts.size > 0) {
            usedPath = path;
            break;
        }
    }

    // Build result objects
    const total = arr.length;
    const groups: ReduceResultGroup[] = Array.from(counts.entries())
        .map(([key, count]) => ({
            key,
            count,
            percent: total ? (count / total) * 100 : 0
        }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const top = groups.slice(0, topN);

    // Pagination / completeness heuristics (Medusa responses commonly include count/limit/offset)
    const metaObj =
        typeof response === "object" && response !== null
            ? (response as Record<string, unknown>)
            : {};
    const countMeta =
        typeof metaObj.count === "number"
            ? (metaObj.count as number)
            : undefined;
    const limitMeta =
        typeof metaObj.limit === "number"
            ? (metaObj.limit as number)
            : undefined;
    const offsetMeta =
        typeof metaObj.offset === "number" ? (metaObj.offset as number) : 0;
    let incomplete = false;
    if (countMeta !== undefined && offsetMeta + arr.length < countMeta) {
        incomplete = true;
    } else if (limitMeta !== undefined && arr.length === limitMeta) {
        // Could still be complete, but we treat as potentially incomplete.
        incomplete = true;
    }

    return {
        arrayPath,
        groupByPathUsed: usedPath,
        groups,
        top,
        total,
        missing,
        multiValued: multiValueFlags.length > 0,
        incomplete,
        note: usedPath
            ? undefined
            : "No groupBy values extracted from any provided path"
    };
}
