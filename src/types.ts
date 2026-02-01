export type AgentKind = "mcp" | "cli";

export type ExperimentTask = {
  id: string;
  server: "filesystem" | "github" | "search";
  tool: string;
  args: Record<string, unknown>;
  naturalLanguagePrompt: string;
};

export type RunMetrics = {
  taskId: string;
  model: string;
  agent: AgentKind;
  runIndex: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  toolCallCount: number;
  retries: number;
  errors: number;
  durationMs: number;
  timestamp: string;
  success: boolean;
  errorMessage?: string;
};

export type SummaryRow = {
  taskId: string;
  model: string;
  agent: AgentKind;
  runs: number;
  avgTotalTokens: number;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgToolCallCount: number;
  avgRetries: number;
  avgErrors: number;
  avgDurationMs: number;
};

export type SummaryDiff = {
  taskId: string;
  model: string;
  metric: keyof Omit<SummaryRow, "taskId" | "agent" | "runs" | "model">;
  mcp: number;
  cli: number;
  delta: number;
  percentChange: number;
};

export type SummaryFile = {
  generatedAt: string;
  runsPerTask: number;
  averages: SummaryRow[];
  deltas: SummaryDiff[];
};
