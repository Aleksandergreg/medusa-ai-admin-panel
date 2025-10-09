/**
 * Manages pending validation requests for destructive operations
 */

import {
  PendingValidation,
  ValidationRequest,
  ValidationResponse,
} from "./validation-types";

class ValidationManager {
  private pendingValidations = new Map<string, PendingValidation>();

  createValidationRequest(
    operationId: string,
    method: string,
    path: string,
    args: Record<string, unknown>,
    bodyFieldEnums?: Record<string, string[]>,
    bodyFieldReadOnly?: string[],
    resourcePreview?: Record<string, unknown>
  ): { request: ValidationRequest; promise: Promise<boolean> } {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const request: ValidationRequest = {
      id,
      operationId,
      method,
      path,
      args,
      timestamp: new Date(),
      bodyFieldEnums,
      bodyFieldReadOnly,
      resourcePreview,
    };

    const promise = new Promise<boolean>((resolve, reject) => {
      this.pendingValidations.set(id, {
        request,
        resolve,
        reject,
      });

      // Auto-reject after 5 minutes
      setTimeout(() => {
        if (this.pendingValidations.has(id)) {
          this.rejectValidation(id, new Error("Validation timeout"));
        }
      }, 5 * 60 * 1000);
    });

    return { request, promise };
  }

  respondToValidation(response: ValidationResponse): void {
    const pending = this.pendingValidations.get(response.id);
    if (!pending) {
      throw new Error(`No pending validation found for id: ${response.id}`);
    }

    pending.resolve(response.approved);
    this.pendingValidations.delete(response.id);
  }

  rejectValidation(id: string, error: Error): void {
    const pending = this.pendingValidations.get(id);
    if (pending) {
      pending.reject(error);
      this.pendingValidations.delete(id);
    }
  }

  getPendingValidations(): ValidationRequest[] {
    return Array.from(this.pendingValidations.values()).map((v) => v.request);
  }

  hasPendingValidation(id: string): boolean {
    return this.pendingValidations.has(id);
  }

  clear(): void {
    for (const pending of this.pendingValidations.values()) {
      pending.reject(new Error("Validation manager cleared"));
    }
    this.pendingValidations.clear();
  }
}

// Singleton instance
export const validationManager = new ValidationManager();
