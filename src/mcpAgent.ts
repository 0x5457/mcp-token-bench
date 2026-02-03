import type { MCPServer, Model } from "@openai/agents";
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
  private debug = process.env.DEBUG_BENCH === "1";

  constructor(
    model: string | Model,
    servers: MCPServerConfig[],
    systemPrompt: string,
  ) {
    const timeoutMs = Number(process.env.MCP_SERVER_TIMEOUT_MS ?? 20000);
    const serverTimeout =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
    const sessionTimeoutSec = Number(
      process.env.MCP_CLIENT_SESSION_TIMEOUT_SEC ?? 20,
    );
    const clientSessionTimeoutSeconds =
      Number.isFinite(sessionTimeoutSec) && sessionTimeoutSec > 0
        ? sessionTimeoutSec
        : undefined;
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
          clientSessionTimeoutSeconds,
          timeout: serverTimeout,
        });
      }
      return new MCPServerStreamableHttp({
        name: server.name,
        url: server.url,
        requestInit: server.headers ? { headers: server.headers } : undefined,
        toolFilter,
        clientSessionTimeoutSeconds,
        timeout: serverTimeout,
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
    if (this.debug) {
      console.log(
        "[bench] mcp runTask",
        JSON.stringify(
          {
            workflowName,
            server: task.server,
            tool: task.tool,
            args: task.args,
          },
          null,
          2,
        ),
      );
    }
    const runner = new Runner({
      workflowName,
      traceMetadata: {
        taskId: task.id,
        server: task.server,
        tool: task.tool,
      },
    });
    return runner.run(this.agent, task.naturalLanguagePrompt, { stream: true });
  }
}
