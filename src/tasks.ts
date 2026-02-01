import path from "node:path";
import { sampleDataDir } from "./config.js";
import { ExperimentTask } from "./types.js";

const githubOwner = process.env.GITHUB_OWNER || "github";
const githubRepo = process.env.GITHUB_REPO || "github-mcp-server";
const githubFullName = `${githubOwner}/${githubRepo}`;

export const tasks: ExperimentTask[] = [
  {
    id: "filesystem.read.sample",
    server: "filesystem",
    tool: "read_file",
    args: {
      path: path.join(sampleDataDir, "notes.md")
    },
    naturalLanguagePrompt:
      "Call the MCP tool 'read_file' with the provided args and return only the raw JSON tool result. Do not add any commentary or summary."
  },
  {
    id: "filesystem.search.tokens",
    server: "filesystem",
    tool: "search_files",
    args: {
      path: sampleDataDir,
      pattern: "token"
    },
    naturalLanguagePrompt:
      "Call the MCP tool 'search_files' with the provided args and return only the raw JSON tool result. Do not add any commentary or summary."
  },
  {
    id: "github.list.repo",
    server: "github",
    tool: "get_repository_tree",
    args: {
      owner: githubOwner,
      repo: githubRepo,
      recursive: false
    },
    naturalLanguagePrompt:
      `Call the MCP tool 'get_repository_tree' for ${githubFullName} with the provided args and return only the raw JSON tool result. Do not add any commentary or summary.`
  },
  {
    id: "github.search.code",
    server: "github",
    tool: "search_code",
    args: {
      query: `repo:${githubFullName} mcp`,
      perPage: 5
    },
    naturalLanguagePrompt:
      `Call the MCP tool 'search_code' with the provided args for ${githubFullName} and return only the raw JSON tool result. Do not add any commentary or summary.`
  },
  {
    id: "search.web.mcp",
    server: "search",
    tool: "brave_web_search",
    args: {
      query: "Model Context Protocol MCP architecture",
      count: 5
    },
    naturalLanguagePrompt:
      "Call the MCP tool 'brave_web_search' with the provided args and return only the raw JSON tool result. Do not add any commentary or summary."
  },
  {
    id: "search.local.coffee",
    server: "search",
    tool: "brave_local_search",
    args: {
      query: "coffee",
      count: 5,
      country: "US"
    },
    naturalLanguagePrompt:
      "Call the MCP tool 'brave_local_search' with the provided args and return only the raw JSON tool result. Do not add any commentary or summary."
  }
];
