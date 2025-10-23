import { HistoryEntry } from "../../lib/types";
import { isPlainRecord } from "../../lib/utils";
import {
  SchemaAdherenceEnumViolation,
  SchemaAdherenceReport,
} from "./types";
import {
  extractOperationIdentifier,
  normalizeOperationIdentifier,
} from "./operation-utils";

type ParameterSummary = {
  name: string;
  in: string;
  required?: boolean;
};

export type SchemaToolSummary = {
  operationId: string;
  method?: string;
  path?: string;
  exampleUrl?: string;
  pathParams?: ParameterSummary[];
  queryParams?: ParameterSummary[];
  headerParams?: ParameterSummary[];
  requiredBodyFields?: string[];
  bodyFieldEnums?: Record<string, unknown[]>;
  bodyFieldReadOnly?: string[];
};

export type ExecutionArgsSnapshot = {
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  body?: unknown;
};

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (isPlainRecord(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
};

const normalizeKey = (key: string): string =>
  key.replace(/\[\d+\]/g, "").replace(/\[[^\]]*]/g, "").replace(/\[]$/, "");

const hasPresentValue = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
};

export function findLastExecutionArgs(
  history: HistoryEntry[],
  operationId: string
): ExecutionArgsSnapshot | null {
  const normalizedTarget = normalizeOperationIdentifier(operationId);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (!entry || entry.tool_name !== "openapi.execute") {
      continue;
    }
    const args = toRecord(entry.tool_args);
    if (!args) {
      continue;
    }
    const entryOperationId = extractOperationIdentifier(args);
    if (!entryOperationId) {
      continue;
    }
    const normalizedEntry = normalizeOperationIdentifier(entryOperationId);
    if (normalizedEntry !== normalizedTarget) {
      continue;
    }

    const pathParams =
      toRecord(args.pathParams) ?? toRecord((args as Record<string, unknown>).path_parameters);
    const query =
      toRecord(args.query) ?? toRecord((args as Record<string, unknown>).queryParams);
    const headers =
      toRecord(args.headers) ?? toRecord((args as Record<string, unknown>).headerParams);
    const body =
      (args.body ??
        (args as Record<string, unknown>).data ??
        (args as Record<string, unknown>).payload) ?? undefined;

    return {
      pathParams,
      query,
      headers,
      body,
    };
  }
  return null;
}

const toParameterArray = (value: unknown): ParameterSummary[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!isPlainRecord(entry)) {
        return null;
      }
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (!name) {
        return null;
      }
      const location =
        typeof entry.in === "string" && entry.in.trim().length
          ? entry.in.trim()
          : "query";
      const required =
        entry.required === true ? true : entry.required === false ? false : undefined;
      return {
        name,
        in: location,
        ...(required !== undefined ? { required } : {}),
      };
    })
    .filter((entry): entry is ParameterSummary => entry !== null);
};

const sanitizeStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];

const toEnumMap = (
  value: unknown
): Record<string, unknown[]> | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    ([, enumValues]) => Array.isArray(enumValues) && enumValues.length > 0
  ) as Array<[string, unknown[]]>;
  if (!entries.length) {
    return undefined;
  }
  const map: Record<string, unknown[]> = {};
  for (const [field, enumValues] of entries) {
    map[field] = enumValues;
  }
  return map;
};

export function toSchemaToolSummary(raw: unknown): SchemaToolSummary | null {
  if (!isPlainRecord(raw)) {
    return null;
  }
  const operationId =
    typeof raw.operationId === "string" && raw.operationId.trim().length
      ? raw.operationId.trim()
      : null;
  if (!operationId) {
    return null;
  }

  const method =
    typeof raw.method === "string" && raw.method.trim().length
      ? raw.method.trim()
      : undefined;
  const path =
    typeof raw.path === "string" && raw.path.trim().length
      ? raw.path.trim()
      : undefined;
  const exampleUrl =
    typeof (raw as Record<string, unknown>).exampleUrl === "string" &&
    (raw as Record<string, unknown>).exampleUrl?.trim().length
      ? ((raw as Record<string, unknown>).exampleUrl as string).trim()
      : undefined;

  const summary: SchemaToolSummary = {
    operationId,
    method,
    path,
    exampleUrl,
    pathParams: toParameterArray((raw as Record<string, unknown>).pathParams),
    queryParams: toParameterArray(
      (raw as Record<string, unknown>).queryParams
    ),
    headerParams: toParameterArray(
      (raw as Record<string, unknown>).headerParams
    ),
    requiredBodyFields: sanitizeStringList(
      (raw as Record<string, unknown>).requiredBodyFields
    ),
    bodyFieldReadOnly: sanitizeStringList(
      (raw as Record<string, unknown>).bodyFieldReadOnly
    ),
    bodyFieldEnums: toEnumMap(
      (raw as Record<string, unknown>).bodyFieldEnums
    ),
  };

  return summary;
}

const requiredParams = (
  params: ParameterSummary[] | undefined,
  includeWhen: (param: ParameterSummary) => boolean
): string[] => {
  if (!params?.length) {
    return [];
  }
  return params
    .filter((param) => param?.name)
    .filter(includeWhen)
    .map((param) => param.name.trim());
};

const gatherProvidedKeys = (
  record: Record<string, unknown> | undefined
): { raw: string[]; normalized: Set<string> } => {
  if (!record) {
    return { raw: [], normalized: new Set<string>() };
  }
  const raw = Object.keys(record);
  const normalized = new Set(raw.map(normalizeKey));
  return { raw, normalized };
};

const splitPath = (path: string): string[] =>
  path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const getNestedValue = (value: unknown, path: string[]): unknown[] => {
  if (!path.length) {
    return hasPresentValue(value) ? [value] : [];
  }

  const [head, ...tail] = path;
  const isArraySegment = head.endsWith("[]");
  const key = isArraySegment ? head.slice(0, -2) : head;

  if (!isArraySegment) {
    if (!isPlainRecord(value)) {
      return [];
    }
    const next = (value as Record<string, unknown>)[key];
    return getNestedValue(next, tail);
  }

  const target = key ? (isPlainRecord(value) ? (value as Record<string, unknown>)[key] : undefined) : value;
  if (!Array.isArray(target) || target.length === 0) {
    return [];
  }

  if (!tail.length) {
    return target.filter(hasPresentValue);
  }

  const collected: unknown[] = [];
  for (const item of target) {
    collected.push(...getNestedValue(item, tail));
  }
  return collected;
};

const hasPathValue = (source: unknown, path: string): boolean => {
  const values = getNestedValue(source, splitPath(path));
  return values.some(hasPresentValue);
};

const collectEnumViolations = (
  body: unknown,
  enums: Record<string, unknown[]>
): SchemaAdherenceEnumViolation[] => {
  const violations: SchemaAdherenceEnumViolation[] = [];
  for (const [field, allowedValues] of Object.entries(enums)) {
    if (!Array.isArray(allowedValues) || !allowedValues.length) {
      continue;
    }
    const values = getNestedValue(body, splitPath(field));
    if (!values.length) {
      continue;
    }
    const invalid = values.filter(
      (value) =>
        !allowedValues.some((allowed) => JSON.stringify(allowed) === JSON.stringify(value))
    );
    if (!invalid.length) {
      continue;
    }
    violations.push({
      field,
      allowed: allowedValues,
      received: invalid,
    });
  }
  return violations;
};

const summarizeNotes = (data: {
  missingPathParams: string[];
  missingQueryParams: string[];
  missingHeaders: string[];
  missingBodyFields: string[];
  readOnlyViolations: string[];
  enumViolations: SchemaAdherenceEnumViolation[];
  unknownQueryParams: string[];
  unknownHeaders: string[];
}): string[] => {
  const notes: string[] = [];

  if (data.missingPathParams.length) {
    notes.push(
      `Missing path params: ${data.missingPathParams.join(", ")}`
    );
  }
  if (data.missingQueryParams.length) {
    notes.push(
      `Missing required query params: ${data.missingQueryParams.join(", ")}`
    );
  }
  if (data.missingHeaders.length) {
    notes.push(
      `Missing required headers: ${data.missingHeaders.join(", ")}`
    );
  }
  if (data.missingBodyFields.length) {
    notes.push(
      `Missing required body fields: ${data.missingBodyFields.join(", ")}`
    );
  }
  if (data.readOnlyViolations.length) {
    notes.push(
      `Read-only fields present in body: ${data.readOnlyViolations.join(", ")}`
    );
  }
  if (data.enumViolations.length) {
    const fields = data.enumViolations.map((item) => item.field);
    notes.push(`Enum violations: ${fields.join(", ")}`);
  }
  if (data.unknownQueryParams.length) {
    notes.push(
      `Unknown query params: ${data.unknownQueryParams.join(", ")}`
    );
  }
  if (data.unknownHeaders.length) {
    notes.push(
      `Unknown headers: ${data.unknownHeaders.join(", ")}`
    );
  }

  if (!notes.length) {
    notes.push("All provided params match the schema.");
  }

  return notes;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const calculatePenalty = (data: {
  missingPathParams: string[];
  missingBodyFields: string[];
  readOnlyViolations: string[];
  enumViolations: SchemaAdherenceEnumViolation[];
  unknownQueryParams: string[];
  unknownHeaders: string[];
  missingQueryParams: string[];
  missingHeaders: string[];
}): number => {
  const enumCount = data.enumViolations.reduce(
    (sum, item) => sum + item.received.length,
    0
  );

  const penalties = [
    Math.min(data.missingPathParams.length * 2, 4),
    Math.min(data.missingBodyFields.length * 2, 4),
    Math.min(data.readOnlyViolations.length * 2, 4),
    Math.min(enumCount, 3),
    Math.min(data.unknownQueryParams.length, 2),
    Math.min(data.unknownHeaders.length, 2),
    Math.min(data.missingQueryParams.length, 2),
    Math.min(data.missingHeaders.length, 2),
  ];

  const total = penalties.reduce((sum, value) => sum + value, 0);
  return clamp(total, 0, 5);
};

export function evaluateSchemaAdherence(params: {
  operationId: string;
  schema: SchemaToolSummary;
  args: ExecutionArgsSnapshot | null | undefined;
}): SchemaAdherenceReport | null {
  const { operationId, schema, args } = params;
  if (!args || !schema) {
    return null;
  }

  const requiredPath = requiredParams(schema.pathParams, (param) => {
    if (param.in === "path") {
      return true;
    }
    return Boolean(param.required);
  });

  const requiredQuery = requiredParams(
    schema.queryParams,
    (param) => param.required === true
  );
  const requiredHeaders = requiredParams(
    schema.headerParams,
    (param) => param.required === true
  );

  const providedPath = args.pathParams ?? {};
  const providedQuery = args.query ?? {};
  const providedHeaders = args.headers ?? {};
  const body = args.body;

  const missingPathParams = requiredPath.filter(
    (name) => !hasPresentValue(providedPath?.[name])
  );

  const queryKeys = gatherProvidedKeys(providedQuery);
  const headerKeys = gatherProvidedKeys(providedHeaders);

  const missingQueryParams = requiredQuery.filter(
    (name) => !queryKeys.normalized.has(name)
  );
  const missingHeaders = requiredHeaders.filter(
    (name) => !headerKeys.normalized.has(name)
  );

  const allowedQuery = new Set(
    (schema.queryParams ?? [])
      .filter((param) => typeof param.name === "string")
      .map((param) => param.name.trim())
  );
  const allowedHeaders = new Set(
    (schema.headerParams ?? [])
      .filter((param) => typeof param.name === "string")
      .map((param) => param.name.trim().toLowerCase())
  );

  const unknownQueryParams = queryKeys.raw
    .filter((key) => !allowedQuery.has(normalizeKey(key)));
  const unknownHeaders = headerKeys.raw
    .filter(
      (key) => !allowedHeaders.has(normalizeKey(key).toLowerCase())
    );

  const requiredBodyFields = sanitizeStringList(schema.requiredBodyFields);
  const missingBodyFields = requiredBodyFields.filter(
    (field) => !hasPathValue(body, field)
  );

  const readOnlyFields = sanitizeStringList(schema.bodyFieldReadOnly);
  const readOnlyViolations = readOnlyFields.filter((field) =>
    hasPathValue(body, field)
  );

  const enumViolations = schema.bodyFieldEnums
    ? collectEnumViolations(body, schema.bodyFieldEnums)
    : [];

  const penalty = calculatePenalty({
    missingPathParams,
    missingBodyFields,
    readOnlyViolations,
    enumViolations,
    unknownQueryParams,
    unknownHeaders,
    missingQueryParams,
    missingHeaders,
  });

  const notes = summarizeNotes({
    missingPathParams,
    missingQueryParams,
    missingHeaders,
    missingBodyFields,
    readOnlyViolations,
    enumViolations,
    unknownQueryParams,
    unknownHeaders,
  });

  return {
    operationId,
    method: schema.method,
    path: schema.path,
    exampleUrl: schema.exampleUrl,
    missingPathParams,
    missingQueryParams,
    missingHeaders,
    missingBodyFields,
    readOnlyViolations,
    enumViolations,
    unknownQueryParams,
    unknownHeaders,
    penalty,
    notes,
  };
}
