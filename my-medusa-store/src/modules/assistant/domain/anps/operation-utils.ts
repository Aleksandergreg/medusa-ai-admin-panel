export const normalizeOperationIdentifier = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_-]+/g, "");

export const extractOperationIdentifier = (
  args: Record<string, unknown>
): string | null => {
  const camel = args.operationId;
  if (typeof camel === "string" && camel.trim()) {
    return camel.trim();
  }

  const snake = (args as Record<string, unknown>).operation_id;
  if (typeof snake === "string" && snake.trim()) {
    return snake.trim();
  }

  return null;
};
