export interface AssistantModuleOptions {
  /** Maximum number of steps the assistant can take in a single conversation */
  maxSteps: number;
  /** Default AI model to use for planning */
  modelName: string;
  /** Optional higher-capacity model used to craft the final user-facing answer */
  finalModelName?: string;
  /** Controls when the higher-capacity model is used for final responses */
  finalModelStrategy?: "always" | "adaptive" | "never";
  /** Threshold score for the adaptive final model strategy */
  finalModelAdaptiveThreshold?: number;
  /** Gemini API key for AI integration */
  geminiApiKey?: string;
  /** Planner mode: 'ci' for deterministic CI mode, 'live' for LLM integration */
  plannerMode: 'ci' | 'live';
}

export const DEFAULT_ASSISTANT_OPTIONS: AssistantModuleOptions = {
  maxSteps: 25,
  modelName: "gemini-2.5-flash",
  finalModelStrategy: "adaptive",
  finalModelAdaptiveThreshold: 3,
  plannerMode: "live"
};
