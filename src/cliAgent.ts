import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
  Model,
  Shell,
  ShellAction,
  ShellOutputResult,
  ShellResult,
} from "@openai/agents";
import { Agent, Runner, tool } from "@openai/agents";
import { z } from "zod";
import { cliConfigPath } from "./config.js";
import type { ExperimentTask } from "./types.js";

const execAsync = promisify(exec);

const stripAnsiPattern =
  "[\\u001B\\u009B][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]";
const stripAnsiRegex = new RegExp(stripAnsiPattern, "g");

const stripAnsi = (value: string): string => value.replace(stripAnsiRegex, "");

class LocalShell implements Shell {
  async run(action: ShellAction): Promise<ShellResult> {
    const outputs: ShellOutputResult[] = [];
    let remaining = action.maxOutputLength ?? null;

    const applyLimit = (value: string): string => {
      if (remaining === null) {
        return value;
      }
      if (remaining <= 0) {
        return "";
      }
      const slice = value.slice(0, remaining);
      remaining -= slice.length;
      return slice;
    };

    for (const command of action.commands) {
      try {
        const result = await execAsync(command, {
          timeout: action.timeoutMs ?? 120_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        outputs.push({
          stdout: applyLimit(stripAnsi(result.stdout)),
          stderr: applyLimit(stripAnsi(result.stderr)),
          outcome: { type: "exit", exitCode: 0 },
        });
      } catch (error) {
        const err = error as {
          stdout?: string;
          stderr?: string;
          code?: number | string | null;
          killed?: boolean;
          signal?: string | null;
          message?: string;
        };
        const stdout = typeof err.stdout === "string" ? err.stdout : "";
        const stderr =
          typeof err.stderr === "string"
            ? err.stderr
            : err.message
              ? err.message
              : "";
        const isTimeout =
          err.killed === true ||
          err.code === "ETIMEDOUT" ||
          err.signal === "SIGTERM";
        outputs.push({
          stdout: applyLimit(stripAnsi(stdout)),
          stderr: applyLimit(stripAnsi(stderr)),
          outcome: isTimeout
            ? { type: "timeout" }
            : {
                type: "exit",
                exitCode: typeof err.code === "number" ? err.code : null,
              },
        });
      }
    }

    return {
      output: outputs,
      maxOutputLength: action.maxOutputLength,
    };
  }
}

export const buildCliCommand = (
  task: ExperimentTask,
  configPath: string,
): string => {
  const cliBinary = process.env.MCP_CLI_BIN?.trim() || "mcp-cli";
  return [
    "NO_COLOR=1",
    cliBinary,
    "call",
    "-c",
    configPath,
    task.server,
    task.tool,
    `'${JSON.stringify(task.args)}'`,
  ].join(" ");
};

export class CLIAgentRunner {
  private agent: Agent;
  private debug = process.env.DEBUG_BENCH === "1";
  private dynamicMode: boolean;

  constructor(model: string | Model, systemPrompt: string) {
    const shell = new LocalShell();
    const shellCommandTool = tool({
      name: "run_shell_command",
      description:
        "Run a local shell command and return stdout, stderr, and exit status.",
      parameters: z.object({
        command: z.string(),
        timeoutMs: z.number().optional(),
        maxOutputLength: z.number().optional(),
      }),
      execute: async ({ command, timeoutMs, maxOutputLength }) => {
        return shell.run({
          commands: [command],
          timeoutMs,
          maxOutputLength,
        });
      },
    });
    this.agent = new Agent({
      name: "CLI MCP Agent",
      instructions: systemPrompt,
      model,
      tools: [shellCommandTool],
    });
    this.dynamicMode = systemPrompt.includes("Available commands:");
  }

  async runTask(task: ExperimentTask, workflowName: string): Promise<unknown> {
    if (!this.dynamicMode) {
      let prompt = task.naturalLanguagePrompt;
      const command = buildCliCommand(task, cliConfigPath);
      if (this.debug) {
        console.log(
          "[bench] cli command",
          JSON.stringify({ workflowName, command }, null, 2),
        );
      }

      prompt =
        `${task.naturalLanguagePrompt}\n\n` +
        "Use the run_shell_command tool with JSON " +
        `{"command": "${command}"} and return only the raw JSON tool result.`;

      const runner = new Runner({
        workflowName,
        traceMetadata: {
          taskId: task.id,
          server: task.server,
          tool: task.tool,
        },
      });
      return runner.run(this.agent, prompt, { stream: true });
    }

    const argsJson = JSON.stringify(task.args);
    const dynamicPrompt = [
      "Use only mcp-cli for all operations. Do not use direct shell commands like cat.",
      "You may use: mcp-cli list-servers, list-tools, describe-tool, call.",
      `Target server: "${task.server}". Target tool: "${task.tool}".`,
      `You must call the tool with args JSON exactly as provided: ${argsJson}`,
      "Use shell pipes to reduce output size.",
      "Required: pipe through `jq -c '.'` and `head -c 5000`.",
      "If you list tools, filter with `grep` to minimize output.",
      "",
      task.naturalLanguagePrompt,
    ].join("\n");

    if (this.debug) {
      console.log(
        "[bench] cli dynamic prompt",
        JSON.stringify({ workflowName }, null, 2),
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
    return runner.run(this.agent, dynamicPrompt, { stream: true });
  }
}
