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

// Trace logging is on by default; set TRACE_LOG=0 to disable.
const traceLogEnabled = (): boolean => process.env.TRACE_LOG !== "0";
const traceLogFormat = (): "json" | "pretty" =>
  process.env.TRACE_LOG_FORMAT === "json" ? "json" : "pretty";

const previewJson = (value: unknown, limit = 2000): string | null => {
  if (value === undefined) {
    return null;
  }
  const unwrap = (input: string): string => {
    let current = input;
    for (let i = 0; i < 3; i += 1) {
      const trimmed = current.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return current;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        current = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
      } catch {
        return current;
      }
    }
    return current;
  };
  let text: string;
  if (typeof value === "string") {
    text = unwrap(value);
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...(${text.length - limit} more chars)`;
};

const logTrace = (label: string, payload: Record<string, unknown>): void => {
  if (!traceLogEnabled()) {
    return;
  }
  if (traceLogFormat() === "json") {
    console.log(`[trace] ${label} ${JSON.stringify(payload)}`);
    return;
  }
  console.log(`[trace] ${label}`, payload);
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
    let spanJson: unknown;
    if (typeof toJson === "function") {
      try {
        spanJson = toJson();
      } catch {
        spanJson = undefined;
      }
    }
    const error =
      getRecordProp(span, "error") ?? getRecordProp(spanJson, "error");

    if (error) {
      record.errors += 1;
    }

    if (getStringProp(spanData, "type") === "function") {
      record.toolCallCount += 1;
      const toolName = getStringProp(spanData, "name") ?? "unknown";
      logTrace("tool", {
        traceId,
        name: toolName,
        input: previewJson(getRecordProp(spanData, "input")),
        output: previewJson(getRecordProp(spanData, "output")),
        error: previewJson(error),
      });

      if (error) {
        record.pendingErrorsByTool[toolName] =
          (record.pendingErrorsByTool[toolName] ?? 0) + 1;
      } else if ((record.pendingErrorsByTool[toolName] ?? 0) > 0) {
        record.retries += 1;
        record.pendingErrorsByTool[toolName] -= 1;
      }
      return;
    }

    const spanType = getStringProp(spanData, "type");
    if (spanType === "model" || spanType === "llm" || spanType === "chat") {
      const input =
        getRecordProp(spanData, "input") ??
        getRecordProp(spanJson, "input") ??
        getRecordProp(spanJson, "messages");
      const output =
        getRecordProp(spanData, "output") ??
        getRecordProp(spanJson, "output") ??
        getRecordProp(spanJson, "response");
      logTrace("model", {
        traceId,
        type: spanType,
        input: previewJson(input),
        output: previewJson(output),
        error: previewJson(error),
      });
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
