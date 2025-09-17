import { defineTool } from "../utils/define-tools";
import type { InventoryServiceDefinition } from "../types/inventory";


type InventoryService = InventoryServiceDefinition;

export function createInventoryTools(
    inventory: InventoryService
): Array<ReturnType<typeof defineTool>> {
    const DEFAULT_LOW_INV_THRESHOLD = 5;
    const low_inventory_products_count = defineTool((z) => ({
        name: "low_inventory_products_count",
        description:
            "Count distinct products that have at least one variant with inventory below a threshold. Defaults to manage_inventory=true. Returns { threshold, count, variants_count }.",
        inputSchema: {
            threshold: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe(
                    `Inventory threshold (e.g., 100, 50, 200). Default: ${DEFAULT_LOW_INV_THRESHOLD}`
                ),
            manage_inventory_only: z
                .boolean()
                .optional()
                .describe(
                    "If true, only consider variants where manage_inventory is enabled (default true)."
                )
        },
        handler: async (input: Record<string, unknown>): Promise<unknown> => {
            const schema = z.object({
                threshold: z.coerce
                    .number()
                    .int()
                    .min(0)
                    .default(DEFAULT_LOW_INV_THRESHOLD),
                manage_inventory_only: z.boolean().optional()
            });
            const parsed = schema.safeParse(input);
            if (!parsed.success) {
                throw new Error(`Invalid input: ${parsed.error.message}`);
            }

            const res = await inventory.countLowInventoryProducts({
                threshold: parsed.data.threshold,
                manage_inventory_only: parsed.data.manage_inventory_only
            });
            return res;
        }
    }));

    const low_inventory_products_list = defineTool((z) => ({
        name: "low_inventory_products_list",
        description:
            "List products that have at least one variant with inventory below a threshold. Returns product id, title, and low variants with inventory quantity, reserved quantity, and inventory item location breakdown.",
        inputSchema: {
            threshold: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe(
                    `Inventory threshold (e.g., 100, 50, 200). Default: ${DEFAULT_LOW_INV_THRESHOLD}`
                ),
            manage_inventory_only: z
                .boolean()
                .optional()
                .describe(
                    "If true, only consider variants where manage_inventory is enabled (default true)."
                ),
            limit: z
                .number()
                .int()
                .min(1)
                .max(200)
                .optional()
                .describe("Maximum number of products to return (default 50)."),
            include_variants: z
                .boolean()
                .optional()
                .describe(
                    "Whether to include detailed low variants per product (default true)."
                )
        },
        handler: async (input: Record<string, unknown>): Promise<unknown> => {
            const schema = z.object({
                threshold: z.coerce
                    .number()
                    .int()
                    .min(0)
                    .default(DEFAULT_LOW_INV_THRESHOLD),
                manage_inventory_only: z.boolean().optional(),
                limit: z.coerce.number().int().min(1).max(200).optional(),
                include_variants: z.boolean().optional()
            });
            const parsed = schema.safeParse(input);
            if (!parsed.success) {
                throw new Error(`Invalid input: ${parsed.error.message}`);
            }

            const res = await inventory.listLowInventoryProducts({
                threshold: parsed.data.threshold,
                manage_inventory_only: parsed.data.manage_inventory_only
            });

            // Sort by number of low variants desc
            const sorted = [...res.products].sort(
                (a, b) => b.low_variants_count - a.low_variants_count
            );
            const limit = parsed.data.limit ?? 50;
            const includeVariants = parsed.data.include_variants ?? true;
            const limited = sorted.slice(0, limit);

            const products = includeVariants
                ? limited
                : limited.map((p) => ({
                      id: p.id,
                      title: p.title,
                      low_variants_count: p.low_variants_count
                  }));

            return {
                threshold: res.threshold,
                count: res.count,
                variants_count: res.variants_count,
                products
            };
        }
    }));

    return [low_inventory_products_count, low_inventory_products_list];
}
