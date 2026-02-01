import fs from "node:fs";
import path from "node:path";
import { getGlobalTraceProvider } from "@openai/agents";
import { defaultRunsPerTask, resultsDir } from "./config.js";
import { CLIAgentRunner } from "./cliAgent.js";
import { MCPAgentRunner } from "./mcpAgent.js";
import { TraceCollector } from "./traceCollector.js";
import { ExperimentTask, RunMetrics, SummaryFile } from "./types.js";
import { summarizeRuns, summarizeDiffs } from "./metrics.js";

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const nowIso = (): string => new Date().toISOString();

const writeJson = (filePath: string, data: unknown): void => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

export class ExperimentRunner {
  constructor(
    private readonly mcpAgent: MCPAgentRunner,
    private readonly cliAgent: CLIAgentRunner,
    private readonly traceCollector: TraceCollector
  ) {}

  async run(tasks: ExperimentTask[], runsPerTask = defaultRunsPerTask): Promise<void> {
    ensureDir(resultsDir);

    const runs: RunMetrics[] = [];

    for (const task of tasks) {
      for (let i = 0; i < runsPerTask; i += 1) {
        runs.push(await this.runSingle(task, i, "mcp"));
        runs.push(await this.runSingle(task, i, "cli"));
      }
    }

    const summary: SummaryFile = {
      generatedAt: nowIso(),
      runsPerTask,
      averages: summarizeRuns(runs),
      deltas: summarizeDiffs(summarizeRuns(runs))
    };

    writeJson(path.join(resultsDir, "raw-results.json"), runs);
    writeJson(path.join(resultsDir, "summary.json"), summary);
  }

  private async runSingle(task: ExperimentTask, runIndex: number, agent: "mcp" | "cli"): Promise<RunMetrics> {
    const start = Date.now();
    const workflowName = `mcp-bench:${task.id}:${agent}:run-${runIndex}`;

    try {
      const result =
        agent === "mcp"
          ? await this.mcpAgent.runTask(task, workflowName)
          : await this.cliAgent.runTask(task, workflowName);

      await getGlobalTraceProvider().forceFlush();
      const trace = this.traceCollector.consumeLatest();

      const usage = (result as any)?.state?.usage ?? {};
      const promptTokens = usage.inputTokens ?? 0;
      const completionTokens = usage.outputTokens ?? 0;
      const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;

      return {
        taskId: task.id,
        agent,
        runIndex,
        totalTokens,
        promptTokens,
        completionTokens,
        toolCallCount: trace?.toolCallCount ?? 0,
        retries: trace?.retries ?? 0,
        errors: trace?.errors ?? 0,
        durationMs: Date.now() - start,
        timestamp: nowIso(),
        success: true
      };
    } catch (error) {
      await getGlobalTraceProvider().forceFlush();
      const trace = this.traceCollector.consumeLatest();
      const message = error instanceof Error ? error.message : String(error);
      return {
        taskId: task.id,
        agent,
        runIndex,
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        toolCallCount: trace?.toolCallCount ?? 0,
        retries: trace?.retries ?? 0,
        errors: trace?.errors ?? 1,
        durationMs: Date.now() - start,
        timestamp: nowIso(),
        success: false,
        errorMessage: message
      };
    }
  }
}
