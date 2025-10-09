export function formatOperationTitle(operationId: string): string {
  // Convert AdminPostPromotions -> Create Promotion
  const withoutPrefix = operationId.replace(
    /^(Admin|Store)(Post|Delete|Put|Patch)/i,
    ""
  );

  // Add spaces before capital letters and handle plural
  const spaced = withoutPrefix.replace(/([A-Z])/g, " $1").trim();

  // Determine action
  const isDelete = /Delete/i.test(operationId);
  const isUpdate = /Put|Patch/i.test(operationId);
  const isCreate = /Post/i.test(operationId);

  let action = "Modify";
  if (isDelete) action = "Delete";
  else if (isCreate) action = "Create";
  else if (isUpdate) action = "Update";

  return `${action} ${spaced}`;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}
