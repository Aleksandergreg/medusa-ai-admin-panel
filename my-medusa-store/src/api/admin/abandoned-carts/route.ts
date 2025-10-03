import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import AbandonedCartsService from "../../../modules/abandoned-carts/service"
import { ABANDONED_CARTS_MODULE } from "../../../modules/abandoned-carts"
/**
 * @oas [get] /admin/abandoned-carts
 * operationId: AdminGetAbandonedCarts
 * summary: List abandoned carts
 * x-authenticated: true
 * tags:
 *   - Admin Abandoned Carts
 * parameters:
 *   - in: query
 *     name: older_than_minutes
 *     schema: { type: integer, minimum: 0, default: 1440 }
 *   - in: query
 *     name: require_email
 *     schema: { type: boolean, default: true }
 *   - in: query
 *     name: min_items
 *     schema: { type: integer, minimum: 0, default: 1 }
 *   - in: query
 *     name: limit
 *     schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *   - in: query
 *     name: offset
 *     schema: { type: integer, minimum: 0, default: 0 }
 *   - in: query
 *     name: with_customer
 *     schema: { type: boolean, default: true }
 * responses:
 *   "200":
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             total_matching: { type: integer }
 *             filtered_count: { type: integer }
 *             limit: { type: integer }
 *             offset: { type: integer }
 *             older_than_minutes: { type: integer }
 *             require_email: { type: boolean }
 *             min_items: { type: integer }
 *             carts:
 *               type: array
 *               items:
 *                 type: object
 *                 description: Abandoned cart (partial). Structure may vary.
 *                 additionalProperties: true
 *   "500":
 *     description: Server error
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             message: { type: string }
 */

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
    const olderThanMinutes = Math.max(0, Number(req.query?.older_than_minutes ?? 1440))
    const requireEmail = String(req.query?.require_email ?? "true").toLowerCase() !== "false"
    const minItems = Math.max(0, Number(req.query?.min_items ?? 1))
    const take = Math.max(1, Math.min(100, Number(req.query?.limit ?? 50)))
    const skip = Math.max(0, Number(req.query?.offset ?? 0))
    const withCustomer = String(req.query?.with_customer ?? "true").toLowerCase() !== "false"

    const svc = req.scope.resolve<AbandonedCartsService>(ABANDONED_CARTS_MODULE)
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { carts, totalMatching, filteredCount } = await svc.list({
      olderThanMinutes,
      requireEmail,
      minItems,
      take,
      skip,
      withCustomer,
    }, { query })

    return res.status(200).json({
      total_matching: totalMatching,
      filtered_count: filteredCount,
      limit: take,
      offset: skip,
      older_than_minutes: olderThanMinutes,
      require_email: requireEmail,
      min_items: minItems,
      carts,
    })
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? String(e) })
  }
}