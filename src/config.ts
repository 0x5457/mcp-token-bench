import path from "node:path";

export type MCPServerConfig =
  | {
      name: "filesystem" | "github" | "search";
      kind: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
      allowedTools: string[];
    }
  | {
      name: "filesystem" | "github" | "search";
      kind: "http";
      url: string;
      headers?: Record<string, string>;
      allowedTools: string[];
    };

export const defaultRunsPerTask = 3;

export const resultsDir = path.resolve(process.cwd(), "results");

export const sampleDataDir = path.resolve(process.cwd(), "sample_data");

export const defaultModel = process.env.OPENAI_MODEL ?? "gpt-5-mini";

export const defaultServers: MCPServerConfig[] = [
  {
    name: "filesystem",
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", sampleDataDir],
    allowedTools: ["read_file", "search_files"],
  },
  {
    name: "github",
    kind: "stdio",
    command: "github-mcp-server",
    args: ["--read-only"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN:
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
    },
    allowedTools: ["get_repository_tree", "search_code"],
  },
  {
    name: "search",
    kind: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: {
      BRAVE_API_KEY: process.env.BRAVE_API_KEY ?? "",
    },
    allowedTools: ["brave_web_search", "brave_local_search"],
  },
];

export const cliConfigPath = path.resolve(process.cwd(), "mcp_servers.json");
