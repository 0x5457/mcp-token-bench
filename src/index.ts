import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  type Model,
  setDefaultOpenAIKey,
  setTraceProcessors,
} from "@openai/agents";
import { aisdk } from "@openai/agents-extensions";
import { CLIAgentRunner } from "./cliAgent.js";
import {
  defaultModel,
  defaultModelList,
  defaultRunsPerTask,
  defaultServers,
  cliConfigPath,
  resultsDir,
} from "./config.js";
import { ExperimentRunner } from "./experiment.js";
import { MCPAgentRunner } from "./mcpAgent.js";
import { summarizeDiffs, summarizeRuns } from "./metrics.js";
import { filterTasksByServer, tasks } from "./tasks.js";
import { TraceCollector } from "./traceCollector.js";
import type { RunMetrics, SummaryFile } from "./types.js";

const parseArgs = (): {
  runs: number;
  models: string[];
  modelProvider: string;
  aiSdkProvider: string;
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
  const modelsFromArgs = parseList(args.get("--models"));
  const modelsFromEnv = parseList(
    process.env.OPENAI_MODELS ?? process.env.AI_SDK_MODELS,
  );
  const models =
    modelsFromArgs.length > 0
      ? modelsFromArgs
      : modelsFromEnv.length > 0
        ? modelsFromEnv
        : defaultModelList.length > 0
          ? defaultModelList
          : [model];
  const modelProvider = (
    args.get("--provider") ??
    process.env.MODEL_PROVIDER ??
    "openai"
  ).toLowerCase();
  const aiSdkProvider = (
    args.get("--ai-sdk-provider") ??
    process.env.AI_SDK_PROVIDER ??
    "openai"
  ).toLowerCase();
  const taskFilter = args
    .get("--tasks")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    runs: Number.isFinite(runs) && runs > 0 ? runs : defaultRunsPerTask,
    models,
    modelProvider,
    aiSdkProvider,
    taskFilter: taskFilter && taskFilter.length > 0 ? taskFilter : undefined,
  };
};

const parseList = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const ensureDir = (dir: string): void => {
  fs.mkdirSync(dir, { recursive: true });
};

const nowIso = (): string => new Date().toISOString();

const writeJson = (filePath: string, data: unknown): void => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

const resolveAiSdkBaseUrl = (): string | undefined => {
  const baseUrl =
    process.env.AI_SDK_BASE_URL ?? process.env.AI_SDK_HOST ?? undefined;
  return baseUrl?.trim() ? baseUrl.trim() : undefined;
};

const debugEnabled = (): boolean => process.env.DEBUG_BENCH === "1";

const buildAiSdkModel = (provider: string, modelName: string): Model => {
  const baseURL = resolveAiSdkBaseUrl();
  switch (provider) {
    case "openai":
      return aisdk((baseURL ? createOpenAI({ baseURL }) : openai)(modelName));
    case "anthropic":
      return aisdk(
        (baseURL ? createAnthropic({ baseURL }) : anthropic)(modelName),
      );
    case "google":
      return aisdk(
        (baseURL ? createGoogleGenerativeAI({ baseURL }) : google)(modelName),
      );
    default:
      throw new Error(
        `Unsupported AI SDK provider: ${provider}. Supported: openai, anthropic, google.`,
      );
  }
};

const buildModel = (
  modelProvider: string,
  aiSdkProvider: string,
  modelName: string,
): { model: string | Model; modelId: string } => {
  if (modelProvider === "aisdk" || modelProvider === "ai-sdk") {
    return {
      model: buildAiSdkModel(aiSdkProvider, modelName),
      modelId: `aisdk:${aiSdkProvider}:${modelName}`,
    };
  }
  return { model: modelName, modelId: modelName };
};

const main = async (): Promise<void> => {
  const { runs, models, modelProvider, aiSdkProvider, taskFilter } =
    parseArgs();
  if (debugEnabled()) {
    console.log(
      "[bench] config",
      JSON.stringify(
        {
          runs,
          models,
          modelProvider,
          aiSdkProvider,
          aiSdkBaseUrl: resolveAiSdkBaseUrl() ?? null,
          taskFilter: taskFilter ?? null,
        },
        null,
        2,
      ),
    );
  }

  const usingAiSdk = modelProvider === "aisdk" || modelProvider === "ai-sdk";
  if (!usingAiSdk) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required.");
    }
    setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
  } else {
    if (aiSdkProvider === "openai") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required for AI SDK openai.");
      }
      setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
    }
    if (aiSdkProvider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is required for AI SDK anthropic.");
    }
    if (
      aiSdkProvider === "google" &&
      !process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ) {
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY is required for AI SDK google.",
      );
    }
  }

  const systemPrompt =
    "You are running a deterministic benchmark. Use the available tools exactly once per task. " +
    "Return only the raw JSON tool result and no commentary.";

  const cliPrompt =
    "You are a problem-solving assistant with access to shell commands. " +
    "You can use mcp-cli to interact with MCP servers. " +
    `Config file: ${cliConfigPath}\n\n` +
    "Available commands:\n" +
    "- mcp-cli list-servers -c <config>\n" +
    "- mcp-cli list-tools -c <config> <server>\n" +
    "- mcp-cli describe-tool -c <config> <server> <tool>\n" +
    "- mcp-cli call -c <config> <server> <tool> '<json>'\n\n" +
    "Shell tools available: grep, jq, head, tail\n" +
    "Process: 1) Discover tools 2) Get schemas if needed 3) Call tool 4) Filter output\n" +
    "Be efficient with tokens - use grep/jq to filter, head to limit output.";

  const traceCollector = new TraceCollector();
  // Keep local trace metrics and avoid exporting traces to OpenAI.
  setTraceProcessors([traceCollector]);

  const serverNames = defaultServers.map((server) => server.name);
  const availableTasks = filterTasksByServer(tasks, serverNames);
  const filteredTasks = taskFilter
    ? availableTasks.filter((task) => taskFilter.includes(task.id))
    : availableTasks;

  const allRuns: RunMetrics[] = [];
  for (const modelName of models) {
    const { model, modelId } = buildModel(
      modelProvider,
      aiSdkProvider,
      modelName,
    );
    const mcpAgent = new MCPAgentRunner(model, defaultServers, systemPrompt);
    await mcpAgent.connect();

    const cliAgent = new CLIAgentRunner(model, cliPrompt);

    const runner = new ExperimentRunner(
      mcpAgent,
      cliAgent,
      traceCollector,
    );
    const runsForModel = await runner.run(filteredTasks, runs, modelId);
    allRuns.push(...runsForModel);

    await mcpAgent.close();
  }

  ensureDir(resultsDir);
  const summary: SummaryFile = {
    generatedAt: nowIso(),
    runsPerTask: runs,
    averages: summarizeRuns(allRuns),
    deltas: summarizeDiffs(summarizeRuns(allRuns)),
  };
  writeJson(path.join(resultsDir, "raw-results.json"), allRuns);
  writeJson(path.join(resultsDir, "summary.json"), summary);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
