import { addTraceProcessor, setDefaultOpenAIKey } from "@openai/agents";
import { CLIAgentRunner } from "./cliAgent.js";
import { defaultModel, defaultRunsPerTask, defaultServers } from "./config.js";
import { ExperimentRunner } from "./experiment.js";
import { MCPAgentRunner } from "./mcpAgent.js";
import { tasks } from "./tasks.js";
import { TraceCollector } from "./traceCollector.js";

const parseArgs = (): {
  runs: number;
  model: string;
  taskFilter?: string[];
} => {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (!key || !key.startsWith("--")) {
      continue;
    }
    if (!value || value.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, value);
    i += 1;
  }

  const runs = Number(args.get("--runs") ?? defaultRunsPerTask);
  const model = args.get("--model") ?? defaultModel;
  const taskFilter = args
    .get("--tasks")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    runs: Number.isFinite(runs) && runs > 0 ? runs : defaultRunsPerTask,
    model,
    taskFilter: taskFilter && taskFilter.length > 0 ? taskFilter : undefined,
  };
};

const main = async (): Promise<void> => {
  const { runs, model, taskFilter } = parseArgs();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required.");
  }
  setDefaultOpenAIKey(process.env.OPENAI_API_KEY);

  const systemPrompt =
    "You are running a deterministic benchmark. Use the available tools exactly once per task. " +
    "Return only the raw JSON tool result and no commentary.";

  const cliPrompt =
    systemPrompt +
    " When using the shell tool, call mcp-cli with `call <server> <tool> <json>` and do not add any other commands.";

  const traceCollector = new TraceCollector();
  addTraceProcessor(traceCollector);

  const filteredTasks = taskFilter
    ? tasks.filter((task) => taskFilter.includes(task.id))
    : tasks;

  const mcpAgent = new MCPAgentRunner(model, defaultServers, systemPrompt);
  await mcpAgent.connect();

  const cliAgent = new CLIAgentRunner(model, cliPrompt);

  const runner = new ExperimentRunner(mcpAgent, cliAgent, traceCollector);
  await runner.run(filteredTasks, runs);

  await mcpAgent.close();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
