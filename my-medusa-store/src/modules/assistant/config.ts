export interface AssistantModuleOptions {
  /** Maximum number of steps the assistant can take in a single conversation */
  maxSteps: number;
  /** Default AI model to use for planning */
  modelName: string;
  /** Gemini API key for AI integration */
  geminiApiKey?: string;
  /** Planner mode: 'ci' for deterministic CI mode, 'live' for LLM integration */
  plannerMode: string;
}

export const DEFAULT_ASSISTANT_OPTIONS: AssistantModuleOptions = {
  maxSteps: 25,
  modelName: "gemini-2.5-flash",
  plannerMode: "live"
};