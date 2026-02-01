import type { Span, Trace, TracingProcessor } from "@openai/agents";

export type TraceMetrics = {
  traceId: string;
  name?: string;
  toolCallCount: number;
  errors: number;
  retries: number;
};

type TraceState = TraceMetrics & {
  pendingErrorsByTool: Record<string, number>;
};

export class TraceCollector implements TracingProcessor {
  private traces = new Map<string, TraceState>();
  private latestTraceId: string | null = null;

  onTraceStart(trace: Trace): void {
    const traceId = (trace as any).traceId ?? (trace as any).id;
    this.latestTraceId = traceId;
    this.traces.set(traceId, {
      traceId,
      name: (trace as any).name,
      toolCallCount: 0,
      errors: 0,
      retries: 0,
      pendingErrorsByTool: {}
    });
  }

  onSpanEnd(span: Span): void {
    const traceId = (span as any).traceId ?? (span as any).trace_id;
    const record = traceId ? this.traces.get(traceId) : undefined;
    if (!record) {
      return;
    }

    const spanData = (span as any).spanData ?? (span as any).data;
    const spanJson = typeof (span as any).toJSON === "function" ? (span as any).toJSON() : undefined;
    const error = (span as any).error ?? spanJson?.error;

    if (error) {
      record.errors += 1;
    }

    if (spanData?.type === "function") {
      record.toolCallCount += 1;
      const toolName = spanData?.name ?? "unknown";

      if (error) {
        record.pendingErrorsByTool[toolName] = (record.pendingErrorsByTool[toolName] ?? 0) + 1;
      } else if ((record.pendingErrorsByTool[toolName] ?? 0) > 0) {
        record.retries += 1;
        record.pendingErrorsByTool[toolName] -= 1;
      }
    }
  }

  consumeLatest(): TraceMetrics | null {
    if (!this.latestTraceId) {
      return null;
    }
    const record = this.traces.get(this.latestTraceId);
    if (!record) {
      return null;
    }
    this.traces.delete(this.latestTraceId);
    const { pendingErrorsByTool: _unused, ...metrics } = record;
    return metrics;
  }
}
