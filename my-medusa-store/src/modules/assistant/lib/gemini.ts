type GeminiCandidatePart = { text?: unknown };
type GeminiCandidate = {
  content?: {
    parts?: GeminiCandidatePart[];
  };
};

type GeminiResponseLike = {
  text?: unknown;
  response?: {
    text?: unknown;
    candidates?: unknown;
  };
  candidates?: unknown;
};

const readText = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "function") {
    try {
      const output = (value as () => unknown)();
      return typeof output === "string" && output.trim()
        ? output.trim()
        : null;
    } catch {
      return null;
    }
  }

  return null;
};

export const extractGeminiText = (res: unknown): string | null => {
  const source = res as GeminiResponseLike | undefined;
  if (!source) {
    return null;
  }

  const direct = readText(source.text);
  if (direct) {
    return direct;
  }

  const responseText = readText(source.response?.text);
  if (responseText) {
    return responseText;
  }

  const candidates =
    (source.response?.candidates ?? source.candidates) as unknown;
  if (!Array.isArray(candidates)) {
    return null;
  }

  for (const candidate of candidates as GeminiCandidate[]) {
    const parts = candidate.content?.parts ?? [];
    if (!Array.isArray(parts) || !parts.length) {
      continue;
    }

    const combined = parts
      .map((part) => readText(part?.text))
      .filter((text): text is string => typeof text === "string")
      .join("")
      .trim();

    if (combined) {
      return combined;
    }
  }

  return null;
};
