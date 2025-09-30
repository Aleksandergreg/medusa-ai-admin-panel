import { ensureMarkdownMinimum } from "./utils";

export const FALLBACK_MESSAGE = ensureMarkdownMinimum(
  "I'm sorry, I couldn't complete that request. Please try rephrasing your question."
);

export type NormalizedPlan =
  | {
      action: "final_answer";
      answer?: string;
      raw: unknown;
    }
  | {
      action: "call_tool";
      tool_name: string;
      tool_args: Record<string, unknown>;
      raw: unknown;
    };

function normalizeAction(action: unknown): "final_answer" | "call_tool" | null {
  if (typeof action !== "string") {
    return null;
  }

  const trimmed = action.trim();
  if (!trimmed) {
    return null;
  }

  // Planner often emits dotted actions such as "openapi.execute". Treat them as tool calls.
  if (trimmed.includes(".")) {
    return "call_tool";
  }

  const snake = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

  switch (snake) {
    case "final_answer":
    case "finalanswer":
    case "final_answer_step":
    case "answer":
    case "respond":
      return "final_answer";
    case "call_tool":
    case "calltool":
    case "tool_call":
    case "toolcall":
    case "use_tool":
    case "tool":
    case "openapi_execute":
    case "openapi_search":
    case "openapi_schema":
      return "call_tool";
    default:
      return null;
  }
}

function coerceAnswer(rawPlan: unknown): string | undefined {
  const candidates = [
    (rawPlan as any)?.answer,
    (rawPlan as any)?.response,
    (rawPlan as any)?.final_answer,
    (rawPlan as any)?.final,
    (rawPlan as any)?.message,
    (rawPlan as any)?.text,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate;
    }
  }

  return undefined;
}

function extractOperationId(plan: any): string | undefined {
  const op =
    plan?.operationId ??
    plan?.operation_id ??
    plan?.tool_args?.operationId ??
    plan?.tool_args?.operation_id;

  if (typeof op === "string" && op.trim().length) {
    return op.trim();
  }
  return undefined;
}

function buildToolName(plan: any): string | undefined {
  const action = plan?.action;
  if (typeof action === "string" && action.includes(".")) {
    return action.trim();
  }

  const tool =
    plan?.tool_name ??
    plan?.toolName ??
    plan?.tool ??
    plan?.call_tool ??
    plan?.tool_call;

  if (typeof tool === "string" && tool.trim().length) {
    return tool.trim();
  }

  return undefined;
}

function buildToolArgs(
  plan: any,
  defaultOperationId?: string
): Record<string, unknown> {
  const rawArgs =
    plan?.tool_args ?? plan?.toolArgs ?? plan?.arguments ?? plan?.args ?? null;

  let args: Record<string, unknown> = {};
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    args = { ...(rawArgs as Record<string, unknown>) };
  }

  if (defaultOperationId && typeof args.operationId !== "string") {
    args.operationId = defaultOperationId;
  }

  return args;
}

export function normalizePlan(rawPlan: unknown): NormalizedPlan {
  if (!rawPlan || Array.isArray(rawPlan)) {
    return {
      action: "final_answer",
      answer: FALLBACK_MESSAGE,
      raw: rawPlan,
    };
  }

  const plan = rawPlan as Record<string, unknown>;
  const normalizedAction = normalizeAction(plan.action);

  if (normalizedAction === "final_answer") {
    const answer = coerceAnswer(plan);
    return {
      action: "final_answer",
      answer: answer,
      raw: rawPlan,
    };
  }

  if (normalizedAction === "call_tool") {
    const operationId = extractOperationId(plan);
    const tool_name = buildToolName(plan) ?? operationId;
    const tool_args = buildToolArgs(plan, operationId);

    if (tool_name) {
      return {
        action: "call_tool",
        tool_name,
        tool_args,
        raw: rawPlan,
      };
    }
  }

  return {
    action: "final_answer",
    answer: FALLBACK_MESSAGE,
    raw: rawPlan,
  };
}
