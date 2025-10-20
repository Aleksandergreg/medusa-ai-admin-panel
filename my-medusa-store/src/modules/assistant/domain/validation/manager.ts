/**
 * Manages pending validation requests for destructive operations
 */

import {
  PendingValidation,
  PendingValidationContext,
  ValidationRequest,
  ValidationResolution,
} from "./types";

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
  ): { request: ValidationRequest; promise: Promise<ValidationResolution> } {
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

    const promise = new Promise<ValidationResolution>((resolve, reject) => {
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

  respondToValidation(response: ValidationResolution): void {
    const pending = this.pendingValidations.get(response.id);
    if (!pending) {
      throw new Error(`No pending validation found for id: ${response.id}`);
    }

    pending.resolve(response);
    this.pendingValidations.delete(response.id);
  }

  attachContext(id: string, context: PendingValidationContext): void {
    const pending = this.pendingValidations.get(id);
    if (!pending) {
      throw new Error(`No pending validation found for id: ${id}`);
    }
    pending.context = context;
  }

  getPendingValidation(id: string): PendingValidation | undefined {
    return this.pendingValidations.get(id);
  }

  getLatestValidationForActor(actorId: string): PendingValidation | undefined {
    const normalizedActorId = actorId?.trim();
    if (!normalizedActorId) {
      return undefined;
    }

    let latest: PendingValidation | undefined;
    for (const pending of this.pendingValidations.values()) {
      if (pending.context?.actorId !== normalizedActorId) {
        continue;
      }

      if (!latest) {
        latest = pending;
        continue;
      }

      const pendingTime =
        pending.request.timestamp instanceof Date
          ? pending.request.timestamp.getTime()
          : new Date(pending.request.timestamp as string).getTime();
      const latestTime =
        latest.request.timestamp instanceof Date
          ? latest.request.timestamp.getTime()
          : new Date(latest.request.timestamp as string).getTime();

      if (pendingTime > latestTime) {
        latest = pending;
      }
    }

    return latest;
  }

  clearContext(id: string): void {
    const pending = this.pendingValidations.get(id);
    if (pending) {
      pending.context = undefined;
    }
  }

  rejectValidation(id: string, error: Error): void {
    const pending = this.pendingValidations.get(id);
    if (pending) {
      pending.reject(error);
      this.pendingValidations.delete(id);
    }
  }

  removeValidation(id: string): PendingValidation | undefined {
    const pending = this.pendingValidations.get(id);
    if (pending) {
      this.pendingValidations.delete(id);
    }
    return pending;
  }

  restoreValidation(pending: PendingValidation): void {
    if (!pending?.request?.id) {
      return;
    }
    this.pendingValidations.set(pending.request.id, pending);
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
