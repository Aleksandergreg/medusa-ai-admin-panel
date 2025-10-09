/**
 * Types for user validation of destructive operations
 */

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

export type ValidationResponse = {
  id: string;
  approved: boolean;
};

export type PendingValidation = {
  request: ValidationRequest;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
};
