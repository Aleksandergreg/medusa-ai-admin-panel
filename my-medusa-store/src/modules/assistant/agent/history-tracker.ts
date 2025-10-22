import { HistoryEntry } from "../lib/types";
import { extractToolJsonPayload } from "../lib/utils";
import { ToolDedupeCache } from "./tool-dedupe-cache";

const DUPLICATE_NOTE_REASON = "duplicate_tool_call";
const DUPLICATE_NOTE_MESSAGE =
  "Skipped identical tool call because the same request already succeeded earlier in this conversation. Reuse the previous result instead of repeating the POST.";

export class HistoryTracker {
  private readonly entries: HistoryEntry[];
  private readonly dedupeCache = new ToolDedupeCache();

  private normalizeMeta(meta?: {
    durationMs?: number | null;
    startedAtMs?: number | null;
    finishedAtMs?: number | null;
  }): HistoryEntry["tool_meta"] | undefined {
    if (!meta) {
      return undefined;
    }
    const toNumber = (value?: number | null): number | undefined =>
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.trunc(value))
        : undefined;

    const duration = toNumber(meta.durationMs);
    const started = toNumber(meta.startedAtMs);
    const finished = toNumber(meta.finishedAtMs);

    if (
      duration === undefined &&
      started === undefined &&
      finished === undefined
    ) {
      return undefined;
    }

    return {
      duration_ms: duration,
      started_at_ms: started,
      finished_at_ms: finished,
    };
  }

  constructor(initialHistory: HistoryEntry[] = []) {
    this.entries = [...initialHistory];
  }

  get list(): HistoryEntry[] {
    return this.entries;
  }

  latestPayload(): unknown {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (!entry) continue;
      if (
        typeof entry.tool_name === "string" &&
        entry.tool_name.startsWith("assistant.")
      ) {
        continue;
      }
      const payload = extractToolJsonPayload(entry.tool_result);
      if (payload !== undefined) {
        return payload;
      }
    }
    return undefined;
  }

  getCachedSuccess(
    toolName: string,
    args: unknown,
    cacheable: boolean
  ): HistoryEntry | undefined {
    if (!cacheable) {
      return undefined;
    }
    return this.dedupeCache.get(toolName, args, cacheable);
  }

  recordDuplicate(toolName: string, reusedEntry?: HistoryEntry): void {
    this.entries.push({
      tool_name: "assistant.note",
      tool_args: {
        reason: DUPLICATE_NOTE_REASON,
        tool_name: toolName,
      },
      tool_result: {
        message: DUPLICATE_NOTE_MESSAGE,
      },
    });

    if (reusedEntry) {
      const { tool_name, tool_args, tool_result, tool_meta } = reusedEntry;
      this.entries.push({
        tool_name,
        tool_args,
        tool_result,
        tool_meta: tool_meta ? { ...tool_meta } : undefined,
      });
    }
  }

  recordError(
    toolName: string,
    args: unknown,
    error: Record<string, unknown>,
    meta?: { durationMs?: number | null; startedAtMs?: number | null; finishedAtMs?: number | null }
  ): void {
    this.entries.push({
      tool_name: toolName,
      tool_args: args,
      tool_result: error,
      tool_meta: this.normalizeMeta(meta),
    });
  }

  recordResult(
    toolName: string,
    args: unknown,
    result: unknown,
    cacheable: boolean,
    meta?: { durationMs?: number | null; startedAtMs?: number | null; finishedAtMs?: number | null }
  ): HistoryEntry {
    const entry: HistoryEntry = {
      tool_name: toolName,
      tool_args: args,
      tool_result: result,
      tool_meta: this.normalizeMeta(meta),
    };
    this.entries.push(entry);

    this.dedupeCache.set(toolName, args, entry, cacheable);

    return entry;
  }

  recordSummary(sourceTool: string, summary: unknown): void {
    this.entries.push({
      tool_name: "assistant.summary",
      tool_args: { source_tool: sourceTool },
      tool_result: { assistant_summary: summary },
    });
  }
}

export function isMutatingExecuteCall(args: unknown): boolean {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return false;
  }
  return "body" in (args as Record<string, unknown>);
}
