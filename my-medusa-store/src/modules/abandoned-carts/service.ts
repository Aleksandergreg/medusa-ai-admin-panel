import { MedusaService } from "@medusajs/framework/utils"

type ListOptions = {
  olderThanMinutes: number
  requireEmail: boolean
  minItems: number
  take: number
  skip: number
  withCustomer: boolean
}

type NormalizedCartItem = {
  id: string
  title: string | null
  quantity: number
  unit_price: number | null
  thumbnail: string | null
}

type NormalizedCart = {
  id: string
  email: string | null
  updated_at: string | Date | null
  items: NormalizedCartItem[]
  customer?:
    | {
        id: string | null
        email: string | null
        first_name: string | null
        last_name: string | null
      }
    | null
  metadata: Record<string, any> | null
}

class AbandonedCartsService extends MedusaService({}) {
  constructor(container: any, options: any = {}) {
    super(container, options)
  }

  async list(options: ListOptions, deps: { query: any }): Promise<{
    carts: NormalizedCart[]
    totalMatching: number
    filteredCount: number
  }> {
    const {
      olderThanMinutes,
      requireEmail,
      minItems,
      take,
      skip,
      withCustomer,
    } = options

    const { query } = deps

    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000)

    const baseFields = ["id", "email", "updated_at", "completed_at", "items.*", "metadata"]
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
      pagination: { skip, take },
    })

    const results = (Array.isArray(carts) ? carts : []).filter((c: any) =>
      (Array.isArray(c?.items) ? c.items.length : 0) >= minItems
    )

    const normalized: NormalizedCart[] = results.map((c: any) => ({
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

    return {
      carts: normalized,
      totalMatching: metadata?.count ?? normalized.length,
      filteredCount: normalized.length,
    }
  }
}

export default AbandonedCartsService