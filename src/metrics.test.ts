import { describe, expect, it } from "vitest";
import { summarizeDiffs, summarizeRuns } from "../src/metrics.js";
import type { RunMetrics } from "../src/types.js";

const baseRun = (overrides: Partial<RunMetrics>): RunMetrics => ({
  taskId: "task-a",
  agent: "mcp",
  runIndex: 0,
  totalTokens: 100,
  promptTokens: 60,
  completionTokens: 40,
  toolCallCount: 2,
  retries: 0,
  errors: 0,
  durationMs: 1000,
  timestamp: "2026-02-01T00:00:00.000Z",
  success: true,
  ...overrides
});

describe("summarizeRuns", () => {
  it("averages runs per task/agent", () => {
    const runs: RunMetrics[] = [
      baseRun({ totalTokens: 100, promptTokens: 50, completionTokens: 50, agent: "mcp", runIndex: 0 }),
      baseRun({ totalTokens: 200, promptTokens: 80, completionTokens: 120, agent: "mcp", runIndex: 1 }),
      baseRun({ totalTokens: 150, promptTokens: 70, completionTokens: 80, agent: "cli", runIndex: 0 })
    ];

    const rows = summarizeRuns(runs);
    const mcpRow = rows.find((row) => row.taskId === "task-a" && row.agent === "mcp");
    const cliRow = rows.find((row) => row.taskId === "task-a" && row.agent === "cli");

    expect(mcpRow).toBeDefined();
    expect(cliRow).toBeDefined();
    expect(mcpRow?.runs).toBe(2);
    expect(mcpRow?.avgTotalTokens).toBe(150);
    expect(mcpRow?.avgPromptTokens).toBe(65);
    expect(mcpRow?.avgCompletionTokens).toBe(85);
    expect(cliRow?.runs).toBe(1);
    expect(cliRow?.avgTotalTokens).toBe(150);
  });
});

describe("summarizeDiffs", () => {
  it("computes deltas and percent changes", () => {
    const rows = summarizeRuns([
      baseRun({ agent: "mcp", totalTokens: 100, promptTokens: 50, completionTokens: 50 }),
      baseRun({ agent: "cli", totalTokens: 150, promptTokens: 70, completionTokens: 80 })
    ]);

    const diffs = summarizeDiffs(rows);
    const totalDiff = diffs.find((diff) => diff.taskId === "task-a" && diff.metric === "avgTotalTokens");

    expect(totalDiff).toBeDefined();
    expect(totalDiff?.mcp).toBe(100);
    expect(totalDiff?.cli).toBe(150);
    expect(totalDiff?.delta).toBe(50);
    expect(totalDiff?.percentChange).toBe(50);
  });

  it("returns 0 percent change when baseline is 0", () => {
    const rows = summarizeRuns([
      baseRun({ agent: "mcp", totalTokens: 0, promptTokens: 0, completionTokens: 0 }),
      baseRun({ agent: "cli", totalTokens: 10, promptTokens: 2, completionTokens: 8 })
    ]);

    const diffs = summarizeDiffs(rows);
    const totalDiff = diffs.find((diff) => diff.taskId === "task-a" && diff.metric === "avgTotalTokens");

    expect(totalDiff?.percentChange).toBe(0);
  });
});
