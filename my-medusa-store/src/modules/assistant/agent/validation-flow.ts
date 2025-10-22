import { MCPResult } from "../lib/utils";
import {
  ValidationContinuationHandler,
  ValidationContinuationPayload,
  ValidationContinuationResult,
  ValidationRequest,
} from "../domain/validation/types";
import { HistoryTracker } from "./history-tracker";
import { ExecuteOutcome, executeTool } from "./tool-executor";
import { buildValidationSummary } from "../domain/validation/summary";

type CreateValidationGateParams = {
  request: ValidationRequest;
  mcp: MCPResult;
  toolName: string;
  args: Record<string, unknown>;
  historyTracker: HistoryTracker;
  cacheable: boolean;
  handleSuccessfulExecution: (ctx: {
    outcome: ExecuteOutcome;
    toolName: string;
    args: Record<string, unknown>;
    cacheable: boolean;
  }) => void;
  runNext: () => Promise<ValidationContinuationResult>;
  step: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeArgsWithEdits = (
  original: Record<string, unknown>,
  edits?: Record<string, unknown>
): Record<string, unknown> => {
  if (!isPlainObject(edits)) {
    return { ...original };
  }

  const mergeRecursive = (
    base: Record<string, unknown>,
    patch: Record<string, unknown>
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(patch)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = mergeRecursive(
          result[key] as Record<string, unknown>,
          value
        );
        continue;
      }

      result[key] = value;
    }

    return result;
  };

  return mergeRecursive(original, edits);
};

export function createValidationGate(
  params: CreateValidationGateParams
): ValidationContinuationResult {
  const {
    request,
    mcp,
    toolName,
    args,
    historyTracker,
    cacheable,
    handleSuccessfulExecution,
    runNext,
    step,
  } = params;

  const validationMessage = buildValidationSummary(
    request,
    historyTracker.list
  );

  const continuation: ValidationContinuationHandler = async (
    payload: ValidationContinuationPayload
  ) => {
    if (!payload.approved) {
      return {
        answer: validationMessage,
        data: request,
        history: historyTracker.list,
      };
    }

    const argsToExecute =
      payload.editedData && isPlainObject(payload.editedData)
        ? mergeArgsWithEdits(args, payload.editedData)
        : { ...args };

    const resumedOutcome = await executeTool(
      {
        mcp,
        toolName,
        args: argsToExecute as Record<string, unknown>,
      },
      { skipValidation: true }
    );

    if (resumedOutcome.error) {
      historyTracker.recordError(
        toolName,
        argsToExecute,
        resumedOutcome.error,
        {
          durationMs: resumedOutcome.durationMs,
          startedAtMs: resumedOutcome.startedAtMs,
          finishedAtMs: resumedOutcome.finishedAtMs,
        }
      );
      return runNext();
    }

    handleSuccessfulExecution({
      outcome: resumedOutcome,
      toolName,
      args: argsToExecute as Record<string, unknown>,
      cacheable,
    });

    return runNext();
  };

  return {
    answer: validationMessage,
    data: request,
    history: historyTracker.list,
    validationRequest: request,
    continuation,
    nextStep: step + 1,
  };
}
