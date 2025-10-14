import { MCPResult } from "../lib/utils";
import { ValidationContinuationHandler, ValidationContinuationPayload, ValidationContinuationResult, ValidationRequest } from "../lib/validation-types";
import { HistoryTracker } from "./history-tracker";
import { ExecuteOutcome, executeTool } from "./tool-executor";
import { buildValidationSummary } from "../lib/validation-summary";

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
};

export function createValidationGate(params: CreateValidationGateParams): ValidationContinuationResult {
  const { request, mcp, toolName, args, historyTracker, cacheable, handleSuccessfulExecution, runNext } = params;

  const validationMessage = buildValidationSummary(request, historyTracker.list);

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

    const argsToExecute = args;

    const resumedOutcome = await executeTool(
      {
        mcp,
        toolName,
        args: argsToExecute as Record<string, unknown>,
      },
      { skipValidation: true }
    );

    if (resumedOutcome.error) {
      historyTracker.recordError(toolName, argsToExecute, resumedOutcome.error);
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
  };
}

