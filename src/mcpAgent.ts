import type { MCPServer } from "@openai/agents";
import {
  Agent,
  createMCPToolStaticFilter,
  MCPServerStdio,
  MCPServerStreamableHttp,
  Runner,
} from "@openai/agents";
import type { MCPServerConfig } from "./config.js";
import type { ExperimentTask } from "./types.js";

const interpolateEnv = (value: string): string => {
  return value.replace(
    /\$\{([A-Z0-9_]+)\}/gi,
    (_, name) => process.env[name] ?? "",
  );
};

const resolveEnvMap = (
  env?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!env) {
    return undefined;
  }
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = interpolateEnv(value);
  }
  return resolved;
};

export class MCPAgentRunner {
  private agent: Agent;
  private servers: MCPServer[] = [];

  constructor(model: string, servers: MCPServerConfig[], systemPrompt: string) {
    this.servers = servers.map((server) => {
      const toolFilter = createMCPToolStaticFilter({
        allowed: server.allowedTools,
      });
      if (server.kind === "stdio") {
        return new MCPServerStdio({
          name: server.name,
          command: server.command,
          args: server.args,
          env: resolveEnvMap(server.env),
          toolFilter,
        });
      }
      return new MCPServerStreamableHttp({
        name: server.name,
        url: server.url,
        requestInit: server.headers ? { headers: server.headers } : undefined,
        toolFilter,
      });
    });

    this.agent = new Agent({
      name: "MCP Native Agent",
      instructions: systemPrompt,
      model,
      mcpServers: this.servers,
    });
  }

  async connect(): Promise<void> {
    for (const server of this.servers) {
      await server.connect();
    }
  }

  async close(): Promise<void> {
    for (const server of this.servers) {
      await server.close();
    }
  }

  async runTask(task: ExperimentTask, workflowName: string): Promise<unknown> {
    const runner = new Runner({
      workflowName,
      traceMetadata: {
        taskId: task.id,
        server: task.server,
        tool: task.tool,
      },
    });
    return runner.run(this.agent, task.naturalLanguagePrompt);
  }
}
