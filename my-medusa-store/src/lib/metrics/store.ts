import crypto from "node:crypto";

type TurnRecord = {
  id: string;
  groundedNumbers: Record<string, number>;
};

class MetricsStore {
  private turns = new Map<string, TurnRecord>();
  private lastTurnId: string | null = null;

  private generateId(): string {
    return (
      crypto.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  }

  startToolCall(_tool: string, _args: any): string {
    return this.generateId();
  }

  endToolCall(_id: string, _rawResult: any, _ok: boolean, _errorMessage?: string): void {}

  startAssistantTurn(_userMessage: any): string {
    const id = this.generateId();
    const turn: TurnRecord = { id, groundedNumbers: {} };
    this.turns.set(id, turn);
    this.lastTurnId = id;
    return id;
  }

  noteToolUsed(_turnId: string, _toolName: string): void {}

  endAssistantTurn(turnId: string, _assistantMessage: any): void {
    if (this.turns.has(turnId)) {
      this.lastTurnId = turnId;
    }
  }

  provideGroundTruth(turnId: string, numbers: Record<string, number>): void {
    const turn = this.turns.get(turnId);
    if (!turn) {
      return;
    }
    turn.groundedNumbers = { ...turn.groundedNumbers, ...numbers };
  }

  validateNumber(
    _turnId: string,
    _label: string,
    _ai: number | undefined,
    _tool: number | undefined,
    _tolerance = 0
  ): void {}

  autoValidateFromAnswer(
    _turnId: string,
    _label: string,
    _tool: number,
    _tolerance = 0
  ): void {}

  getLastTurn(): TurnRecord | undefined {
    return this.lastTurnId ? this.turns.get(this.lastTurnId) : undefined;
  }
}

export const metricsStore = new MetricsStore();

export function withToolLogging<T>(
  _tool: string,
  _args: any,
  fn: () => Promise<T>
): Promise<T> {
  return fn();
}
