import type {
  AuthenticatedMedusaRequest,
  MedusaResponse
} from "@medusajs/framework/http";
import RfmModuleService from "../../../../modules/rfm/service";
import { RFM_MODULE } from "../../../../modules/rfm";

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const service = req.scope.resolve<RfmModuleService>(RFM_MODULE);
  const options = service.configuration;

  return res.json({
    reporting_currency: options.reportingCurrency,
    weights: options.weights,
    winsorize_percentile: options.winsorizePercentile,
    segments: options.segments
  });
}
