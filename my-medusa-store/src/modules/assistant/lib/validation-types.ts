/**
 * Types for user validation of destructive operations
 */

import type { HistoryEntry } from "./types";

export type ValidationRequest = {
  id: string;
  operationId: string;
  method: string;
  path: string;
  args: Record<string, unknown>;
  timestamp: Date;
  bodyFieldEnums?: Record<string, string[]>;
  bodyFieldReadOnly?: string[];
  resourcePreview?: Record<string, unknown>;
};

export type ValidationResolution = {
  id: string;
  approved: boolean;
  editedData?: Record<string, unknown>;
};

export type ValidationContinuationPayload = {
  approved: boolean;
  editedData?: Record<string, unknown>;
};

export type ValidationContinuationResult = {
  answer?: string;
  data: unknown | null;
  history: HistoryEntry[];
  validationRequest?: ValidationRequest;
  continuation?: ValidationContinuationHandler;
  nextStep?: number;
};

export type ValidationContinuationHandler = (
  payload: ValidationContinuationPayload
) => Promise<ValidationContinuationResult>;

export type PendingValidationContext = {
  actorId: string;
  sessionId: string;
  messageId: string;
  continuation?: ValidationContinuationHandler;
  history?: HistoryEntry[];
  nextStep?: number;
  anpsStartedAt?: number;
  userWaitMs?: number;
};

export type PendingValidation = {
  request: ValidationRequest;
  resolve: (resolution: ValidationResolution) => void;
  reject: (error: Error) => void;
  context?: PendingValidationContext;
};
