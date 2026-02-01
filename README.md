# MCP vs CLI MCP Token Benchmark (TypeScript)

A reproducible experiment framework to compare:

1. **MCP-native Agent** using `openai/openai-agents-js` MCP servers directly.
2. **CLI-MCP Agent** using `philschmid/mcp-cli` as a thin transport (`mcp-cli call <server> <tool> <json>`).

Outputs:
- `results/raw-results.json` (all runs + metrics)
- `results/summary.json` (per-task averages + MCP vs CLI deltas)

## Requirements

- Node.js 18+
- `mcp-cli` on PATH
- MCP servers (filesystem, GitHub, search) available
- OpenAI API key

## Setup

```bash
npm install
```

Set environment variables (or copy `.env.sample` to `.env` and fill in keys):

```bash
OPENAI_API_KEY=...
GITHUB_PERSONAL_ACCESS_TOKEN=...
BRAVE_API_KEY=...
```

## Configure MCP Servers

Two configs are used:

1. **Agent (direct MCP)** uses `src/config.ts` defaults.
2. **CLI (mcp-cli)** uses `mcp_servers.json`.

Adjust commands if your MCP servers are installed differently.

### Default servers (stdio)
- `@modelcontextprotocol/server-filesystem`
- `github-mcp-server`
- `@modelcontextprotocol/server-brave-search`

If you run a GitHub MCP server via Docker or HTTP, update `src/config.ts` and `mcp_servers.json` accordingly.

## Run

```bash
npm run dev
```

Optional arguments:

```bash
npm run dev -- --runs 3 --model gpt-5-mini --tasks filesystem.read.sample,github.search.code
```

Multi-model and AI SDK examples:

```bash
# Run multiple OpenAI models in one sweep
npm run dev -- --models gpt-5-mini,gpt-4.1-mini

# Use AI SDK (e.g. Anthropic / Google) models
MODEL_PROVIDER=aisdk AI_SDK_PROVIDER=anthropic AI_SDK_MODELS=claude-3-5-sonnet-20241022 npm run dev
MODEL_PROVIDER=aisdk AI_SDK_PROVIDER=google AI_SDK_MODELS=gemini-1.5-pro-latest npm run dev
```

## Notes

- The CLI agent calls exactly:
  - `mcp-cli call -c mcp_servers.json <server> <tool> <json>`
- Output is expected to be raw JSON. `NO_COLOR=1` is set to avoid ANSI noise.
- Metrics come from `openai-agents-js` tracing/usage; no manual token estimation.
- Retries are inferred from tool-call error spans followed by a subsequent tool call of the same name.
