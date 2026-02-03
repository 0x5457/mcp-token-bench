import { getGlobalTraceProvider } from "@openai/agents";
import type { CLIAgentRunner } from "./cliAgent.js";
import { defaultRunsPerTask } from "./config.js";
import type { MCPAgentRunner } from "./mcpAgent.js";
import type { TraceCollector } from "./traceCollector.js";
import type { AgentKind, ExperimentTask, RunMetrics } from "./types.js";

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

type StreamedResult = {
  completed?: Promise<void>;
};

const awaitStreamCompletion = async (result: unknown): Promise<void> => {
  if (!result || typeof result !== "object") {
    return;
  }
  const streamed = result as StreamedResult;
  if (streamed.completed && typeof streamed.completed.then === "function") {
    await streamed.completed;
  }
};

const nowIso = (): string => new Date().toISOString();
const sanitizeLabel = (value: string): string =>
  value.replace(/[^a-z0-9._-]+/gi, "_");
const debugEnabled = (): boolean => process.env.DEBUG_BENCH === "1";

const formatError = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }
  const extra = error as Error & {
    status?: number;
    code?: string | number;
    cause?: unknown;
    response?: { status?: number; statusText?: string; url?: string };
  };
  return {
    name: error.name,
    message: error.message,
    status: extra.status ?? extra.response?.status ?? null,
    statusText: extra.response?.statusText ?? null,
    url: extra.response?.url ?? null,
    code: extra.code ?? null,
    stack: error.stack ?? null,
    cause: extra.cause ?? null,
  };
};

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
    agent: AgentKind,
    modelId: string,
  ): Promise<RunMetrics> {
    const start = Date.now();
    const workflowName = `mcp-bench:${task.id}:${agent}:${sanitizeLabel(
      modelId,
    )}:run-${runIndex}`;

    try {
      if (debugEnabled()) {
        console.log(
          `[bench] run start`,
          JSON.stringify(
            {
              taskId: task.id,
              agent,
              modelId,
              workflowName,
              server: task.server,
              tool: task.tool,
            },
            null,
            2,
          ),
        );
      }
      let result: unknown;
      if (agent === "mcp") {
        result = await this.mcpAgent.runTask(task, workflowName);
      } else {
      result = await this.cliAgent.runTask(task, workflowName);
      }
      await awaitStreamCompletion(result);

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
      if (debugEnabled()) {
        console.log(
          `[bench] run error`,
          JSON.stringify(
            {
              taskId: task.id,
              agent,
              modelId,
              workflowName,
              error: formatError(error),
            },
            null,
            2,
          ),
        );
      }
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
