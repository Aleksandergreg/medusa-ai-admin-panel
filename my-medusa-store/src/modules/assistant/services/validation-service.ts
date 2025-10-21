import type { Knex } from "knex";
import { validationManager } from "../domain/validation/manager";
import type {
  PendingValidationContext,
  ValidationContinuationResult,
} from "../domain/validation/types";
import { ConversationService } from "./conversation-service";
import { AnpsService } from "./anps-service";
import type { PromptResult, ValidationRequest } from "../lib/types";
import type { AssistantModuleOptions } from "../config";

const DEFAULT_FAILURE_MESSAGE =
  "Sorry, I could not find an answer to your question.";
const CANCEL_MESSAGE =
  `## ❌ Action Cancelled\n\n` +
  `No changes were made to your store. The operation has been cancelled as requested.\n\n` +
  `Feel free to ask me to do something else!`;

export class ValidationService {
  constructor(
    private readonly db: Knex,
    private readonly config: AssistantModuleOptions,
    private readonly conversationService: ConversationService,
    private readonly anpsService: AnpsService
  ) {}

  async handleValidationResponse(params: {
    actorId: string;
    id: string;
    approved: boolean;
    editedData?: Record<string, unknown>;
  }): Promise<PromptResult> {
    const actorId = params.actorId?.trim();
    if (!actorId) {
      throw new Error("Missing actor identifier");
    }

    const id = params.id?.trim();
    if (!id) {
      throw new Error("Missing validation id");
    }

    const pending = validationManager.getPendingValidation(id);
    if (!pending) {
      throw new Error("Validation request not found or expired");
    }

    const context = pending.context;
    if (!context) {
      throw new Error("No continuation context available for this validation");
    }

    if (context.actorId !== actorId) {
      throw new Error("Validation does not belong to this actor");
    }

    const timestampValue = pending.request.timestamp;
    const requestTimestamp =
      timestampValue instanceof Date
        ? timestampValue.getTime()
        : new Date(timestampValue).getTime();
    const waitMs = Number.isFinite(requestTimestamp)
      ? Math.max(0, Date.now() - requestTimestamp)
      : 0;
    const accumulatedUserWaitMs = (context.userWaitMs ?? 0) + waitMs;

    const updatedAt = new Date();

    if (!params.approved) {
      validationManager.respondToValidation({ id, approved: false });
      await this.conversationService.updateConversationMessage(
        context.sessionId,
        context.messageId,
        CANCEL_MESSAGE,
        updatedAt
      );

      const conversation = await this.conversationService.getConversation(
        actorId
      );
      return {
        answer: CANCEL_MESSAGE,
        history: conversation?.history ?? [],
        updatedAt,
      };
    }

    // Add a user message indicating approval
    await this.conversationService.addMessageToConversation(
      context.sessionId,
      "user",
      "✓ Approved",
      updatedAt
    );

    if (!context.continuation) {
      throw new Error("No continuation handler registered for validation");
    }

    let agentResult: ValidationContinuationResult;
    try {
      agentResult = await context.continuation({
        approved: true,
        editedData: params.editedData,
      });
    } catch (error) {
      validationManager.respondToValidation({ id, approved: false });
      throw error;
    }

    const answer = agentResult.answer?.trim()
      ? agentResult.answer
      : DEFAULT_FAILURE_MESSAGE;

    // Add the assistant's response as a new message instead of updating the old one
    const newMessageId =
      await this.conversationService.addMessageToConversation(
        context.sessionId,
        "assistant",
        answer,
        updatedAt
      );

    validationManager.respondToValidation({
      id,
      approved: true,
      editedData: params.editedData,
    });

    const nextValidation = agentResult.validationRequest;
      if (nextValidation && agentResult.continuation) {
        const nextContext: PendingValidationContext = {
          actorId,
          sessionId: context.sessionId,
          messageId: newMessageId,
          continuation: agentResult.continuation,
          history: agentResult.history,
          nextStep: agentResult.nextStep,
          anpsStartedAt: context.anpsStartedAt,
          userWaitMs: accumulatedUserWaitMs,
          prompt: context.prompt,
        };
        validationManager.attachContext(nextValidation.id, nextContext);
      }

    const conversation = await this.conversationService.getConversation(
      actorId
    );

    if (!nextValidation) {
      const durationMs = context.anpsStartedAt
        ? Math.max(0, Date.now() - context.anpsStartedAt)
        : 0;
      const agentComputeMs = Math.max(0, durationMs - accumulatedUserWaitMs);
      this.anpsService.scheduleAnpsSubmission({
        actorId,
        sessionId: context.sessionId,
        history: agentResult.history,
        durationMs,
        agentComputeMs,
        answer,
        prompt: context.prompt,
      });
    }

    return {
      answer,
      history: conversation?.history ?? [],
      updatedAt,
      sessionId: context.sessionId,
      validationRequest: nextValidation as ValidationRequest | undefined,
    };
  }

  getValidationManager() {
    return validationManager;
  }
}
