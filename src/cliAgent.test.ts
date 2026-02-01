import { describe, expect, it } from "vitest";
import { buildCliCommand } from "../src/cliAgent.js";
import type { ExperimentTask } from "../src/types.js";

const task: ExperimentTask = {
  id: "filesystem.read.sample",
  server: "filesystem",
  tool: "read_file",
  args: { path: "/tmp/sample.txt" },
  naturalLanguagePrompt: ""
};

describe("buildCliCommand", () => {
  it("builds an mcp-cli call with JSON args", () => {
    const command = buildCliCommand(task, "/tmp/mcp_servers.json");

    expect(command).toContain("NO_COLOR=1");
    expect(command).toContain("mcp-cli call -c /tmp/mcp_servers.json filesystem read_file");
    expect(command).toContain("'{\"path\":\"/tmp/sample.txt\"}'");
  });
});
