import { GoogleGenAI } from "@google/genai";
import { extractGeminiText } from "../../lib/gemini";

type GenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
};

const DEFAULT_GENERATION_CONFIG: Required<GenerationConfig> = {
  responseMimeType: "application/json",
  temperature: 0.4,
  maxOutputTokens: 512,
};

export interface GeminiFeedbackClientOptions {
  apiKey: string;
  model: string;
}

export interface GeminiFeedbackRequest<T> {
  buildPrompt: () => string;
  parseResponse: (raw: string) => T | null;
  generationConfig?: GenerationConfig;
}

export interface GeminiFeedbackResult<T> {
  rawText: string | null;
  parsed: T | null;
}

export class GeminiFeedbackClient {
  private readonly sdk: GoogleGenAI;

  constructor(private readonly options: GeminiFeedbackClientOptions) {
    this.sdk = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async execute<T>(
    request: GeminiFeedbackRequest<T>
  ): Promise<GeminiFeedbackResult<T>> {
    const prompt = request.buildPrompt();
    const generationConfig = {
      ...DEFAULT_GENERATION_CONFIG,
      ...request.generationConfig,
    };

    const result = await this.sdk.models.generateContent({
      model: this.options.model,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig,
    });

    const rawText = extractGeminiText(result);
    const parsed = rawText ? request.parseResponse(rawText) : null;

    return { rawText, parsed };
  }
}
