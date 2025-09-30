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

function coerceAnswer(rawPlan: any): string | undefined {
  const candidates = [
    rawPlan?.answer,
    rawPlan?.response,
    rawPlan?.final_answer,
    rawPlan?.final,
    rawPlan?.message,
    rawPlan?.text,
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

function buildToolArgs(plan: any, defaultOperationId?: string): Record<string, unknown> {
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

export function normalizePlan(plan: unknown): NormalizedPlan | null {
  if (!plan || typeof plan !== "object") {
    return null;
  }

  const rawAction =
    typeof (plan as any).action === "string" ? (plan as any).action.trim() : undefined;

  const action =
    normalizeAction(rawAction) ??
    normalizeAction((plan as any).intent) ??
    normalizeAction((plan as any).type);

  if (!action) {
    return null;
  }

  if (action === "final_answer") {
    return {
      action,
      answer: coerceAnswer(plan),
      raw: plan,
    };
  }

  const operationId = extractOperationId(plan);

  const toolNameCandidate = (() => {
    const direct =
      (plan as any).tool_name ??
      (plan as any).toolName ??
      (plan as any).tool ??
      (plan as any).name;
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }

    if (rawAction && rawAction.trim() && rawAction.trim().toLowerCase() !== "call_tool") {
      return rawAction.trim();
    }

    if (operationId) {
      // Default to executing the openapi tool when only an operation is provided.
      return "openapi.execute";
    }

    return null;
  })();

  if (!toolNameCandidate) {
    return null;
  }

  const toolArgs = buildToolArgs(plan, operationId);

  return {
    action: "call_tool",
    tool_name: toolNameCandidate,
    tool_args: toolArgs,
    raw: plan,
  };
}
