import { Agent, run, shellTool } from "@openai/agents";
import type { Shell, ShellAction, ShellResult } from "@openai/agents";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { cliConfigPath } from "./config.js";
import { ExperimentTask } from "./types.js";

const execAsync = promisify(exec);

const stripAnsi = (value: string): string =>
  value.replace(/[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

class LocalShell implements Shell {
  async run(action: ShellAction): Promise<ShellResult> {
    const outputs: string[] = [];
    for (const command of action.commands) {
      const result = await execAsync(command, {
        timeout: action.timeoutMs ?? 120_000,
        maxBuffer: 8 * 1024 * 1024
      });
      outputs.push(result.stdout, result.stderr);
    }

    const combined = stripAnsi(outputs.join("")).trim();
    const truncated = action.maxOutputLength ? combined.slice(0, action.maxOutputLength) : combined;
    return { output: truncated };
  }
}

export const buildCliCommand = (task: ExperimentTask, configPath: string): string => {
  return [
    "NO_COLOR=1",
    "mcp-cli",
    "call",
    "-c",
    configPath,
    task.server,
    task.tool,
    `'${JSON.stringify(task.args)}'`
  ].join(" ");
};

export class CLIAgentRunner {
  private agent: Agent;

  constructor(model: string, systemPrompt: string) {
    const shell = new LocalShell();
    this.agent = new Agent({
      name: "CLI MCP Agent",
      instructions: systemPrompt,
      model,
      tools: [shellTool({ shell })]
    });
  }

  async runTask(task: ExperimentTask, workflowName: string): Promise<unknown> {
    const command = buildCliCommand(task, cliConfigPath);

    const prompt = `${task.naturalLanguagePrompt}\n\nUse the shell tool to run:\n${command}`;

    return run(this.agent, prompt, {
      workflowName,
      metadata: {
        taskId: task.id,
        server: task.server,
        tool: task.tool
      }
    });
  }
}
