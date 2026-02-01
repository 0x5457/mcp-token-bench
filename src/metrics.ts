import type { RunMetrics, SummaryDiff, SummaryRow } from "./types.js";

const average = (values: number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export const summarizeRuns = (runs: RunMetrics[]): SummaryRow[] => {
  const byTaskAgent = new Map<string, RunMetrics[]>();
  for (const run of runs) {
    const key = `${run.taskId}::${run.agent}`;
    const list = byTaskAgent.get(key) ?? [];
    list.push(run);
    byTaskAgent.set(key, list);
  }

  return Array.from(byTaskAgent.entries()).map(([key, entries]) => {
    const [taskId, agent] = key.split("::") as [string, "mcp" | "cli"];
    return {
      taskId,
      agent,
      runs: entries.length,
      avgTotalTokens: average(entries.map((run) => run.totalTokens)),
      avgPromptTokens: average(entries.map((run) => run.promptTokens)),
      avgCompletionTokens: average(entries.map((run) => run.completionTokens)),
      avgToolCallCount: average(entries.map((run) => run.toolCallCount)),
      avgRetries: average(entries.map((run) => run.retries)),
      avgErrors: average(entries.map((run) => run.errors)),
      avgDurationMs: average(entries.map((run) => run.durationMs)),
    };
  });
};

export const summarizeDiffs = (rows: SummaryRow[]): SummaryDiff[] => {
  const byTask = new Map<string, { mcp?: SummaryRow; cli?: SummaryRow }>();
  for (const row of rows) {
    const entry = byTask.get(row.taskId) ?? {};
    if (row.agent === "mcp") {
      entry.mcp = row;
    } else {
      entry.cli = row;
    }
    byTask.set(row.taskId, entry);
  }

  const metrics: (keyof Omit<SummaryRow, "taskId" | "agent" | "runs">)[] = [
    "avgTotalTokens",
    "avgPromptTokens",
    "avgCompletionTokens",
    "avgToolCallCount",
    "avgRetries",
    "avgErrors",
    "avgDurationMs",
  ];

  const deltas: SummaryDiff[] = [];
  for (const [taskId, { mcp, cli }] of byTask.entries()) {
    if (!mcp || !cli) {
      continue;
    }
    for (const metric of metrics) {
      const mcpValue = mcp[metric];
      const cliValue = cli[metric];
      const delta = cliValue - mcpValue;
      const percentChange = mcpValue === 0 ? 0 : (delta / mcpValue) * 100;
      deltas.push({
        taskId,
        metric,
        mcp: mcpValue,
        cli: cliValue,
        delta,
        percentChange,
      });
    }
  }

  return deltas;
};
