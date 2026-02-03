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

const githubToken = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "";

const parseModelList = (value?: string): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const envModelList = parseModelList(process.env.OPENAI_MODELS);

export const defaultModelList =
  envModelList.length > 0 ? envModelList : [defaultModel];

const filesystemServer: MCPServerConfig = {
  name: "filesystem",
  kind: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", sampleDataDir],
  allowedTools: ["read_file", "search_files"],
};

const githubServer: MCPServerConfig | null = githubToken
  ? {
      name: "github",
      kind: "stdio",
      command: "docker",
      args: [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "-e",
        "GITHUB_READ_ONLY",
        "ghcr.io/github/github-mcp-server",
      ],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken,
        GITHUB_READ_ONLY: "1",
        GITHUB_TOOLSETS: "default,git",
      },
      allowedTools: ["get_repository_tree", "search_code"],
    }
  : null;

export const defaultServers: MCPServerConfig[] = [
  filesystemServer,
  ...(githubServer ? [githubServer] : []),
];

export const cliConfigPath = path.resolve(process.cwd(), "mcp_servers.json");
