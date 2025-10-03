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
  metadata: Record<string, unknown> | null
}

interface ServiceContainer {
  [key: string]: unknown
}

interface ServiceOptions {
  [key: string]: unknown
}

interface QueryGraphOptions {
  entity: string
  fields: string[]
  filters: Record<string, unknown>
  pagination: {
    skip: number
    take: number
  }
}

interface QueryGraphResult<T> {
  data: T
  metadata?: {
    count?: number
  }
}

interface Query {
  graph: <T = unknown>(options: QueryGraphOptions) => Promise<QueryGraphResult<T>>
}

interface ListDependencies {
  query: Query
}

interface RawCartItem {
  id: string
  title?: string | null
  quantity?: number
  unit_price?: number | null
  thumbnail?: string | null
}

interface RawCartCustomer {
  id?: string | null
  email?: string | null
  first_name?: string | null
  last_name?: string | null
}

interface RawShippingAddress {
  first_name?: string | null
  last_name?: string | null
}

interface RawCart {
  id: string
  email?: string | null
  updated_at?: string | Date | null
  completed_at?: string | Date | null
  items?: RawCartItem[]
  customer?: RawCartCustomer | null
  shipping_address?: RawShippingAddress | null
  metadata?: Record<string, unknown> | null
}

class AbandonedCartsService extends MedusaService({}) {
  constructor(container: ServiceContainer, options: ServiceOptions = {}) {
    super(container, options)
  }

  async list(options: ListOptions, deps: ListDependencies): Promise<{
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

    const filters: Record<string, unknown> = {
      updated_at: { $lt: threshold },
      completed_at: null,
    }

    if (requireEmail) {
      filters.email = { $ne: null }
    }

    const { data: carts, metadata } = await query.graph<RawCart[]>({
      entity: "cart",
      fields,
      filters,
      pagination: { skip, take },
    })

    const results = (Array.isArray(carts) ? carts : []).filter((c: RawCart) =>
      (Array.isArray(c?.items) ? c.items.length : 0) >= minItems
    )

    const normalized: NormalizedCart[] = results.map((c: RawCart) => ({
      id: c.id,
      email: c.email ?? null,
      updated_at: c.updated_at ?? null,
      items: (c.items ?? []).map((it: RawCartItem) => ({
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