import { getGlobalTraceProvider } from "@openai/agents";
import type { CLIAgentRunner } from "./cliAgent.js";
import { defaultRunsPerTask } from "./config.js";
import type { MCPAgentRunner } from "./mcpAgent.js";
import type { TraceCollector } from "./traceCollector.js";
import type { ExperimentTask, RunMetrics } from "./types.js";

type UsageMetrics = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type RunResult = {
  state?: {
    usage?: UsageMetrics;
  };
};

const nowIso = (): string => new Date().toISOString();
const sanitizeLabel = (value: string): string =>
  value.replace(/[^a-z0-9._-]+/gi, "_");

export class ExperimentRunner {
  constructor(
    private readonly mcpAgent: MCPAgentRunner,
    private readonly cliAgent: CLIAgentRunner,
    private readonly traceCollector: TraceCollector,
  ) {}

  async run(
    tasks: ExperimentTask[],
    runsPerTask = defaultRunsPerTask,
    modelId = "default",
  ): Promise<RunMetrics[]> {
    const runs: RunMetrics[] = [];

    for (const task of tasks) {
      for (let i = 0; i < runsPerTask; i += 1) {
        runs.push(await this.runSingle(task, i, "mcp", modelId));
        runs.push(await this.runSingle(task, i, "cli", modelId));
      }
    }

    return runs;
  }

  private async runSingle(
    task: ExperimentTask,
    runIndex: number,
    agent: "mcp" | "cli",
    modelId: string,
  ): Promise<RunMetrics> {
    const start = Date.now();
    const workflowName = `mcp-bench:${task.id}:${agent}:${sanitizeLabel(
      modelId,
    )}:run-${runIndex}`;

    try {
      const result =
        agent === "mcp"
          ? await this.mcpAgent.runTask(task, workflowName)
          : await this.cliAgent.runTask(task, workflowName);

      await getGlobalTraceProvider().forceFlush();
      const trace = this.traceCollector.consumeLatest();

      const usage = (result as RunResult)?.state?.usage ?? {};
      const promptTokens = usage.inputTokens ?? 0;
      const completionTokens = usage.outputTokens ?? 0;
      const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;

      return {
        taskId: task.id,
        model: modelId,
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
        success: true,
      };
    } catch (error) {
      await getGlobalTraceProvider().forceFlush();
      const trace = this.traceCollector.consumeLatest();
      const message = error instanceof Error ? error.message : String(error);
      return {
        taskId: task.id,
        model: modelId,
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
        errorMessage: message,
      };
    }
  }
}
