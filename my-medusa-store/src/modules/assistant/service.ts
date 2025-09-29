import { MedusaService } from "@medusajs/framework/utils";
import { ConversationEntry } from "./lib/types";
import { AssistantModuleOptions, DEFAULT_ASSISTANT_OPTIONS } from "./config";
import { askAgent } from "./agent/ask";

class AssistantModuleService extends MedusaService({}) {
  private readonly config: AssistantModuleOptions;

  constructor(
    container: unknown,
    options: AssistantModuleOptions = DEFAULT_ASSISTANT_OPTIONS
  ) {
    super(container, options);
    this.config = { ...DEFAULT_ASSISTANT_OPTIONS, ...options };
  }

  async prompt(
    prompt: string,
    history: ConversationEntry[] = []
  ): Promise<string> {
    const result = await askAgent(
      {
        prompt,
        history: history.map((h) => ({
          tool_name: "conversation",
          tool_args: { role: h.role },
          tool_result: { content: h.content },
        })),
      },
      { config: this.config }
    );
    return (
      result.answer ?? "Sorry, I could not find an answer to your question."
    );
  }
}

export default AssistantModuleService;
