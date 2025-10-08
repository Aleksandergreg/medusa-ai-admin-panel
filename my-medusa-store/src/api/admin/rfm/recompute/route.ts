import type {
  AuthenticatedMedusaRequest,
  MedusaResponse
} from "@medusajs/framework/http";
import { z } from "zod";
import RfmModuleService, {
  RecomputeOptions
} from "../../../../modules/rfm/service";
import { RFM_MODULE } from "../../../../modules/rfm";

const recomputeSchema = z.object({
  customer_ids: z.array(z.string().min(1)).optional(),
  window_days: z.number().int().min(1).max(3650).optional(),
  chunk_size: z.number().int().min(10).max(5000).optional()
});

type RecomputePayload = z.infer<typeof recomputeSchema>;

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const payload = (req.body ?? {}) as RecomputePayload;
  const parsed = recomputeSchema.safeParse(payload);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: parsed.error.flatten()
    });
  }

  const service = req.scope.resolve<RfmModuleService>(RFM_MODULE);
  const { customer_ids, window_days, chunk_size } = parsed.data;

  const options: RecomputeOptions & { chunkSize?: number } = {
    windowDays: window_days
  };

  if (chunk_size !== undefined) {
    options.chunkSize = chunk_size;
  }

  const summary = customer_ids?.length
    ? await service.recomputeCustomers(customer_ids, options)
    : await service.recomputeAll(options);

  return res.json({
    status: "ok",
    summary
  });
}
