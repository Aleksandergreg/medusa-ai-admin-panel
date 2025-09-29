import { MedusaService } from "@medusajs/framework/utils";
import { ChartType, HistoryEntry } from "./lib/types";
import { AssistantModuleOptions, DEFAULT_ASSISTANT_OPTIONS } from "./config";
import { askAgent } from "./agent/ask";

type AskInput = {
  prompt: string;
  wantsChart?: boolean;
  chartType?: ChartType;
  chartTitle?: string;
  onCancel?: (cancel: () => void) => void;
};

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;

  constructor(container: unknown, options: AssistantModuleOptions = DEFAULT_ASSISTANT_OPTIONS) {
    super(container, options);
    this.config = { ...DEFAULT_ASSISTANT_OPTIONS, ...options };
  }

  async ask(input: AskInput): Promise<{
    answer?: string;
    chart: unknown | null;
    data: unknown | null;
    history: HistoryEntry[];
  }> {
    return askAgent(input, { config: this.config });
  }
}

export default AssistantModuleService;
