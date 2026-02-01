import type { Span, SpanData, Trace, TracingProcessor } from "@openai/agents";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRecordProp = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const getStringProp = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const prop = value[key];
  return typeof prop === "string" ? prop : undefined;
};

const getTraceId = (value: unknown): string | undefined => {
  const traceId = getRecordProp(value, "traceId");
  if (typeof traceId === "string") {
    return traceId;
  }
  if (typeof traceId === "number") {
    return String(traceId);
  }
  const id = getRecordProp(value, "id");
  if (typeof id === "string") {
    return id;
  }
  if (typeof id === "number") {
    return String(id);
  }
  return undefined;
};

const getSpanTraceId = (value: unknown): string | undefined => {
  const traceId = getRecordProp(value, "traceId");
  if (typeof traceId === "string") {
    return traceId;
  }
  if (typeof traceId === "number") {
    return String(traceId);
  }
  const traceIdSnake = getRecordProp(value, "trace_id");
  if (typeof traceIdSnake === "string") {
    return traceIdSnake;
  }
  if (typeof traceIdSnake === "number") {
    return String(traceIdSnake);
  }
  return undefined;
};

export class TraceCollector implements TracingProcessor {
  private traces = new Map<string, TraceState>();
  private latestTraceId: string | null = null;

  async onTraceStart(trace: Trace): Promise<void> {
    const traceId = getTraceId(trace);
    if (!traceId) {
      return;
    }
    this.latestTraceId = traceId;
    this.traces.set(traceId, {
      traceId,
      name: getStringProp(trace, "name"),
      toolCallCount: 0,
      errors: 0,
      retries: 0,
      pendingErrorsByTool: {},
    });
  }

  async onTraceEnd(_trace: Trace): Promise<void> {}

  async onSpanStart(_span: Span<SpanData>): Promise<void> {}

  async onSpanEnd(span: Span<SpanData>): Promise<void> {
    const traceId = getSpanTraceId(span);
    const record = traceId ? this.traces.get(traceId) : undefined;
    if (!record) {
      return;
    }

    const spanData =
      getRecordProp(span, "spanData") ?? getRecordProp(span, "data");
    const toJson = getRecordProp(span, "toJSON");
    const spanJson = typeof toJson === "function" ? toJson() : undefined;
    const error =
      getRecordProp(span, "error") ?? getRecordProp(spanJson, "error");

    if (error) {
      record.errors += 1;
    }

    if (getStringProp(spanData, "type") === "function") {
      record.toolCallCount += 1;
      const toolName = getStringProp(spanData, "name") ?? "unknown";

      if (error) {
        record.pendingErrorsByTool[toolName] =
          (record.pendingErrorsByTool[toolName] ?? 0) + 1;
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

  async shutdown(_timeout?: number): Promise<void> {}

  async forceFlush(): Promise<void> {}
}
