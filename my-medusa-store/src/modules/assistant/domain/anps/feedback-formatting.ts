const sanitizeListItem = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const withoutPrefix = trimmed
    .replace(/^\s*(?:[-*•●]+|\d+[.)])\s*/, "")
    .trim();
  return withoutPrefix;
};

export const normalizeFeedbackItems = (
  input: unknown,
  limit: number
): string[] => {
  if (!input || limit <= 0) {
    return [];
  }

  const items: string[] = [];
  const seen = new Set<string>();

  const addItem = (raw: string) => {
    const cleaned = sanitizeListItem(raw);
    if (!cleaned || seen.has(cleaned)) {
      return;
    }
    seen.add(cleaned);
    items.push(cleaned);
  };

  const visit = (value: unknown): void => {
    if (items.length >= limit || value == null) {
      return;
    }

    if (typeof value === "string") {
      const segments = value.split(/\r?\n+/);
      if (segments.length > 1) {
        for (const segment of segments) {
          if (items.length >= limit) {
            break;
          }
          addItem(segment);
        }
      } else {
        addItem(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (items.length >= limit) {
          break;
        }
        visit(entry);
      }
      return;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;

      for (const key of ["text", "value", "content", "message"]) {
        const candidate = record[key];
        if (typeof candidate === "string") {
          visit(candidate);
        }
      }

      for (const key of [
        "items",
        "values",
        "entries",
        "list",
        "suggestions",
        "improvements",
        "positives",
      ]) {
        const candidate = record[key];
        if (Array.isArray(candidate)) {
          visit(candidate);
        }
      }
    }
  };

  visit(input);

  return items.slice(0, limit);
};

export const MAX_TEXT_CHARS = 4000;

export const truncateText = (
  value: string | null | undefined,
  max = MAX_TEXT_CHARS
): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};
