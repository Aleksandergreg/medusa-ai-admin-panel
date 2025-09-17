import { defineTool } from "../utils/define-tools";
import type { Http } from "../http/client";

export function createCartsTools(http: Http): ReturnType<typeof defineTool>[] {
    const abandoned_carts = defineTool((z) => ({
        name: "abandoned_carts",
        description:
            "List carts that appear abandoned (not completed, last update older than threshold). Returns count and carts with basic fields.",
        inputSchema: {
            older_than_minutes: z
                .number()
                .int()
                .nonnegative()
                .default(1440)
                .describe(
                    "Threshold in minutes; default 1440 = 24h. IMPORTANT: Always pass 'older_than_minutes' (integer). Do not use 'threshold' or synonyms."
                ),
            require_email: z
                .boolean()
                .default(true)
                .describe(
                    "Only include carts with an email address. Set false to include guest carts without email."
                ),
            min_items: z
                .number()
                .int()
                .min(0)
                .default(1)
                .describe("Minimum number of items in cart"),
            limit: z.number().int().min(1).max(100).default(50),
            offset: z.number().int().min(0).default(0),
            with_customer: z
                .boolean()
                .default(true)
                .describe("Include customer fields when available")
        },
        handler: async (input: Record<string, unknown>): Promise<unknown> => {
            // Helpers to coerce natural language inputs --------------------------------
            const isDefined = (v: any): boolean =>
                v !== undefined && v !== null && v !== "";

            const coerceBoolean = (v: any): boolean | undefined => {
                if (typeof v === "boolean") {
                    return v;
                }
                if (typeof v === "string") {
                    const s = v.trim().toLowerCase();
                    if (["true", "1", "yes", "y"].includes(s)) {
                        return true;
                    }
                    if (["false", "0", "no", "n"].includes(s)) {
                        return false;
                    }
                }
                if (typeof v === "number") {
                    return v !== 0;
                }
                return undefined;
            };

            const coerceInt = (v: any): number | undefined => {
                if (typeof v === "number" && Number.isFinite(v)) {
                    return Math.trunc(v);
                }
                if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
                    return parseInt(v.trim(), 10);
                }
                return undefined;
            };

            const parseDurationToMinutes = (v: any): number | undefined => {
                if (typeof v === "number" && Number.isFinite(v)) {
                    return Math.max(0, Math.trunc(v));
                }
                if (typeof v !== "string") {
                    return undefined;
                }
                const s = v.trim().toLowerCase().replace(/ago$/, "").trim();
                // e.g., "1m", "2h", "3d"
                const short = s.match(/^(\d+(?:\.\d+)?)(m|h|d)$/i);
                if (short) {
                    const num = parseFloat(short[1]);
                    const unit = short[2].toLowerCase();
                    if (unit === "m") {
                        return Math.round(num);
                    }
                    if (unit === "h") {
                        return Math.round(num * 60);
                    }
                    if (unit === "d") {
                        return Math.round(num * 1440);
                    }
                }
                // e.g., "1 minute", "2 hours", "3 days", "1 min"
                const long = s.match(
                    /^(\d+(?:\.\d+)?)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d)$/i
                );
                if (long) {
                    const num = parseFloat(long[1]);
                    const unit = long[2].toLowerCase();
                    if (["minute", "minutes", "min", "m"].includes(unit)) {
                        return Math.round(num);
                    }
                    if (["hour", "hours", "hr", "h"].includes(unit)) {
                        return Math.round(num * 60);
                    }
                    if (["day", "days", "d"].includes(unit)) {
                        return Math.round(num * 1440);
                    }
                }
                // numeric string -> minutes
                const asInt = coerceInt(s);
                if (typeof asInt === "number") {
                    return Math.max(0, asInt);
                }
                return undefined;
            };

            // Pull values with aliases
            const getAlias = (
                obj: Record<string, unknown>,
                keys: string[]
            ): unknown => {
                for (const k of keys) {
                    if (isDefined(obj[k])) {
                        return obj[k];
                    }
                }
                return undefined;
            };

            // ... rest of your handler unchanged ...
            const olderRaw = getAlias(input, [
                "older_than_minutes",
                "threshold",
                "threshold_minutes",
                "min_last_updated",
                "minutes_old",
                "min_age"
            ]);
            let older_than_minutes: number | undefined;
            const unitRaw = getAlias(input, ["threshold_unit", "unit"]);
            const unitStr =
                typeof unitRaw === "string"
                    ? unitRaw.toLowerCase().trim()
                    : undefined;
            const numericOlder =
                typeof olderRaw === "number" && Number.isFinite(olderRaw)
                    ? Math.max(0, Math.trunc(olderRaw))
                    : coerceInt(olderRaw);
            if (typeof numericOlder === "number") {
                if (!unitStr) {
                    older_than_minutes = numericOlder;
                } else if (
                    ["m", "min", "minute", "minutes"].includes(unitStr)
                ) {
                    older_than_minutes = numericOlder;
                } else if (["h", "hour", "hours"].includes(unitStr)) {
                    older_than_minutes = numericOlder * 60;
                } else if (["d", "day", "days"].includes(unitStr)) {
                    older_than_minutes = numericOlder * 1440;
                }
            }
            older_than_minutes =
                older_than_minutes ?? parseDurationToMinutes(olderRaw);
            if (older_than_minutes === undefined) {
                older_than_minutes = 1440;
            }

            const requireEmailRaw = getAlias(input, [
                "require_email",
                "with_email"
            ]);
            let require_email = true;
            const reqEmail = coerceBoolean(requireEmailRaw);
            if (typeof reqEmail === "boolean") {
                require_email = reqEmail;
            }

            const minItemsRaw = getAlias(input, [
                "min_items",
                "min_items_count",
                "at_least_items",
                "items_min"
            ]);
            const min_items = coerceInt(minItemsRaw) ?? 1;

            const limit = Math.max(
                1,
                Math.min(
                    100,
                    coerceInt(
                        getAlias(input, ["limit", "take", "top", "page_size"])
                    ) ?? 50
                )
            );
            const offset = Math.max(
                0,
                coerceInt(getAlias(input, ["offset", "skip", "page"])) ?? 0
            );

            const withCustomerRaw = getAlias(input, ["with_customer"]);
            const with_customer = coerceBoolean(withCustomerRaw);

            const params: Record<string, unknown> = {
                older_than_minutes,
                require_email,
                min_items,
                limit,
                offset,
                with_customer: with_customer ?? true
            };

            const res = await http.get<any>("/admin/abandoned-carts", params);
            return res;
        }
    }));

    return [abandoned_carts];
}
