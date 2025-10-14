import { isPlainRecord } from "./utils";

export const LABEL_CANDIDATE_KEYS = [
  "name",
  "title",
  "handle",
  "code",
  "sku",
  "display_name",
  "label",
];

const trimLabel = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
};

export const resolveLabel = (
  raw: unknown,
  labelMap: Map<string, string>
): string | undefined => {
  if (typeof raw !== "string") {
    return undefined;
  }
  const direct = labelMap.get(raw);
  if (direct) {
    return direct;
  }
  return undefined;
};

const collectLabels = (
  value: unknown,
  labelMap: Map<string, string>
): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLabels(entry, labelMap);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  const candidateId = value.id;
  if (typeof candidateId === "string" && !labelMap.has(candidateId)) {
    for (const key of LABEL_CANDIDATE_KEYS) {
      const label = trimLabel(value[key]);
      if (label && label !== candidateId) {
        labelMap.set(candidateId, label);
        break;
      }
    }
  }

  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      if (!key.endsWith("_id")) {
        continue;
      }
      const base = key.slice(0, -3);
      if (!base) {
        continue;
      }
      const baseLabelKeys = [
        `${base}_name`,
        `${base}_title`,
        `${base}_label`,
        `${base}_code`,
        `${base}_handle`,
      ];
      for (const labelKey of baseLabelKeys) {
        const label = trimLabel(value[labelKey]);
        if (label && label !== raw && !labelMap.has(raw)) {
          labelMap.set(raw, label);
          break;
        }
      }
    }
    collectLabels(raw, labelMap);
  }
};

export const buildLabelMap = (...sources: unknown[]): Map<string, string> => {
  const labelMap = new Map<string, string>();
  for (const source of sources) {
    collectLabels(source, labelMap);
  }
  return labelMap;
};

export const pickLabelFromRecord = (
  record: Record<string, unknown> | undefined
): string | undefined => {
  if (!record) {
    return undefined;
  }

  for (const key of LABEL_CANDIDATE_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate.trim();
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
    if (isPlainRecord(value)) {
      const nested = pickLabelFromRecord(value);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
};

