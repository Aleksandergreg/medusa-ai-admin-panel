import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/abandoned-carts
 * Query carts that look "abandoned" (updated_at older than a threshold, not completed).
 * This only returns data — no notifications are sent.
 *
 * Query params:
 * - older_than_minutes: number (default 1440 = 24h)
 * - require_email: boolean (default true)
 * - min_items: number (default 1)
 * - limit: number (1..100, default 50)
 * - offset: number (default 0)
 * - with_customer: boolean (default true)
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const olderThanMinutes = Math.max(0, Number(req.query?.older_than_minutes ?? 1440))
    const requireEmail = String(req.query?.require_email ?? "true").toLowerCase() !== "false"
    const minItems = Math.max(0, Number(req.query?.min_items ?? 1))
    const take = Math.max(1, Math.min(100, Number(req.query?.limit ?? 50)))
    const skip = Math.max(0, Number(req.query?.offset ?? 0))
    const withCustomer = String(req.query?.with_customer ?? "true").toLowerCase() !== "false"

    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000)

    const baseFields = [
      "id",
      "email",
      "updated_at",
      "completed_at",
      "items.*",
      "metadata",
    ]
    const fields = withCustomer ? [...baseFields, "customer.*"] : baseFields

    const filters: any = {
      updated_at: { $lt: threshold },
      completed_at: null,
    }
    if (requireEmail) {
      filters.email = { $ne: null }
    }

    const { data: carts, metadata } = await query.graph({
      entity: "cart",
      fields,
      filters,
      pagination: {
        skip,
        take,
      },
    })

    const results = (Array.isArray(carts) ? carts : []).filter((c: any) =>
      (Array.isArray(c?.items) ? c.items.length : 0) >= minItems
    )

    // Trim output to useful fields only
    const normalized = results.map((c: any) => ({
      id: c.id,
      email: c.email ?? null,
      updated_at: c.updated_at ?? null,
      items: (c.items ?? []).map((it: any) => ({
        id: it.id,
        title: it.title ?? null,
        quantity: it.quantity ?? 0,
        unit_price: it.unit_price ?? null,
        thumbnail: it.thumbnail ?? null,
      })),
      customer: withCustomer
        ? c.customer
          ? {
              id: c.customer.id ?? null,
              email: c.customer.email ?? null,
              first_name: c.customer.first_name ?? c.shipping_address?.first_name ?? null,
              last_name: c.customer.last_name ?? c.shipping_address?.last_name ?? null,
            }
          : null
        : undefined,
      metadata: c.metadata ?? null,
    }))

    return res.status(200).json({
      total_matching: metadata?.count ?? normalized.length,
      filtered_count: normalized.length,
      limit: take,
      offset: skip,
      older_than_minutes: olderThanMinutes,
      require_email: requireEmail,
      min_items: minItems,
      carts: normalized,
    })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? String(e) })
  }
}

