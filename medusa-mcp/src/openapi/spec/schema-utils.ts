import { OpenAPISpec } from "./loader";

type BodyMeta = {
  examples: Record<string, unknown>;
  enums: Record<string, unknown[]>;
  required: Set<string>;
  readOnlyFields: Set<string>;
};

const EMPTY_META = (): BodyMeta => ({
  examples: {},
  enums: {},
  required: new Set<string>(),
  readOnlyFields: new Set<string>(),
});

export function resolveSchema(spec: OpenAPISpec, node: unknown): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return node;
  }
  const maybeRef = (node as { $ref?: unknown }).$ref;
  if (typeof maybeRef !== "string") {
    return node;
  }
  const match = maybeRef.match(/^#\/components\/schemas\/(.+)$/);
  if (!match) {
    return node;
  }
  const schemaName = match[1];
  const resolved = spec.components?.schemas?.[schemaName];
  return resolved ?? node;
}

function walkSchema(
  spec: OpenAPISpec,
  schema: unknown,
  path: string,
  parentRequired: Set<string> | undefined,
  meta: BodyMeta
): void {
  const node = resolveSchema(spec, schema);
  if (!node || typeof node !== "object") {
    return;
  }
  const casted = node as {
    required?: string[];
    properties?: Record<string, unknown>;
    allOf?: unknown[];
    oneOf?: unknown[];
    anyOf?: unknown[];
    items?: unknown;
    type?: string;
    example?: unknown;
    examples?: unknown[];
    enum?: unknown[];
  };

  const baseRequired = parentRequired ? Array.from(parentRequired) : [];
  const declaredRequired = Array.isArray(casted.required)
    ? (casted.required as string[])
    : [];
  const currentRequired = new Set<string>([
    ...baseRequired,
    ...declaredRequired,
  ]);

  const recordExample = (schemaNode: unknown, schemaPath: string): void => {
    if (!schemaNode || typeof schemaNode !== "object") {
      return;
    }
    const s = schemaNode as {
      example?: unknown;
      examples?: unknown[];
      enum?: unknown[];
      readOnly?: boolean;
    };
    if (s.example !== undefined) {
      meta.examples[schemaPath] = s.example;
    } else if (Array.isArray(s.examples) && s.examples.length) {
      meta.examples[schemaPath] = s.examples[0];
    }
    if (Array.isArray(s.enum) && s.enum.length) {
      if (meta.enums[schemaPath]) {
        meta.enums[schemaPath] = [
          ...new Set([...meta.enums[schemaPath], ...s.enum]),
        ];
      } else {
        meta.enums[schemaPath] = s.enum;
      }
    }
    if (s.readOnly === true) {
      meta.readOnlyFields.add(schemaPath);
    }
  };

  if (casted.properties && typeof casted.properties === "object") {
    for (const [key, value] of Object.entries(casted.properties)) {
      const nextPath = path ? `${path}.${key}` : key;
      const resolved = resolveSchema(spec, value);
      if (currentRequired.has(key)) {
        meta.required.add(nextPath);
      }
      recordExample(resolved, nextPath);
      walkSchema(spec, resolved, nextPath, currentRequired, meta);
    }
  }

  if (casted.type === "array" && casted.items) {
    const arrayPath = path ? `${path}[]` : "[]";
    recordExample(node, arrayPath);
    walkSchema(spec, casted.items, arrayPath, parentRequired, meta);
  }

  (casted.allOf ?? []).forEach((child) =>
    walkSchema(spec, child, path, currentRequired, meta)
  );
  (casted.oneOf ?? []).forEach((child) =>
    walkSchema(spec, child, path, parentRequired, meta)
  );
  (casted.anyOf ?? []).forEach((child) =>
    walkSchema(spec, child, path, parentRequired, meta)
  );
}

export function collectBodyMetadata(
  spec: OpenAPISpec,
  schema: unknown
): {
  examples: Record<string, unknown>;
  enums: Record<string, unknown[]>;
  required: string[];
  readOnlyFields: string[];
} {
  const meta = EMPTY_META();
  walkSchema(spec, schema, "", undefined, meta);
  return {
    examples: meta.examples,
    enums: meta.enums,
    required: Array.from(meta.required),
    readOnlyFields: Array.from(meta.readOnlyFields),
  };
}
