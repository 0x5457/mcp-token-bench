import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, Image } from "canvas";
import { JSDOM } from "jsdom";
import type { Data, Layout } from "plotly.js";
import { meanStd, wilsonInterval } from "./plotStats.js";

type Summary = {
  generatedAt: string;
  runsPerTask: number;
  averages: AverageRow[];
};

type AverageRow = {
  taskId?: string;
  model?: string;
  agent?: string;
  avgTotalTokens?: number;
  avgPromptTokens?: number;
  avgCompletionTokens?: number;
  avgToolCallCount?: number;
  avgRetries?: number;
  avgErrors?: number;
  avgDurationMs?: number;
};

type RawRow = {
  taskId: string;
  model: string;
  agent: string;
  durationMs: number;
  success: boolean;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  toolCallCount?: number;
  retries?: number;
  errors?: number;
};

const summary = JSON.parse(
  readFileSync(join("results", "summary.json"), "utf8"),
) as Summary;
const raw = JSON.parse(
  readFileSync(join("results", "raw-results.json"), "utf8"),
) as RawRow[];

const averages = summary.averages ?? [];
const successOnly = raw.filter((r) => r.success === true);

const uniq = <T>(arr: T[]) => Array.from(new Set(arr));
const by = <T extends Record<string, unknown>>(
  arr: T[],
  key: keyof T,
): string[] =>
  uniq(
    arr
      .map((x) => x[key])
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value)),
  );

const fallbackTasks = by(raw, "taskId");
const fallbackAgents = by(raw, "agent");
const fallbackModels = by(raw, "model");

const taskIds = by(averages, "taskId").length
  ? by(averages, "taskId")
  : fallbackTasks;
const agents = by(averages, "agent").length
  ? by(averages, "agent")
  : fallbackAgents;
const models = by(averages, "model").length
  ? by(averages, "model")
  : fallbackModels;

// Success rate per task/model/agent
const successRate = new Map<string, number>();
const count = new Map<string, number>();
for (const row of raw) {
  const key = `${row.taskId}||${row.model}||${row.agent}`;
  count.set(key, (count.get(key) ?? 0) + 1);
  successRate.set(key, (successRate.get(key) ?? 0) + (row.success ? 1 : 0));
}

// JSDOM + Canvas shim for Plotly image export
// Plotly (via d3) expects a browser-like global `self`.
const globalShim = globalThis as GlobalShim;
if (!("self" in globalShim)) {
  (globalShim as Record<string, unknown>).self = globalShim;
}
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const { document } = dom.window;
type GlobalShim = Omit<
  typeof globalThis,
  | "window"
  | "document"
  | "navigator"
  | "Image"
  | "HTMLCanvasElement"
  | "getComputedStyle"
> & {
  window?: unknown;
  document?: Document;
  navigator?: Navigator;
  Image?: typeof dom.window.Image;
  HTMLCanvasElement?: typeof dom.window.HTMLCanvasElement;
  getComputedStyle?: typeof dom.window.getComputedStyle;
};
globalShim.window = dom.window;
globalShim.document = document;
if (!("navigator" in globalShim)) {
  Object.defineProperty(globalShim, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: false,
  });
}
if (!("DOMParser" in globalShim)) {
  Object.defineProperty(globalShim, "DOMParser", {
    value: dom.window.DOMParser,
    configurable: true,
    writable: false,
  });
}
if (!("HTMLElement" in globalShim)) {
  Object.defineProperty(globalShim, "HTMLElement", {
    value: dom.window.HTMLElement,
    configurable: true,
    writable: false,
  });
}
if (!("SVGElement" in globalShim)) {
  Object.defineProperty(globalShim, "SVGElement", {
    value: dom.window.SVGElement,
    configurable: true,
    writable: false,
  });
}
if (!("Element" in globalShim)) {
  Object.defineProperty(globalShim, "Element", {
    value: dom.window.Element,
    configurable: true,
    writable: false,
  });
}
globalShim.Image = Image as unknown as typeof dom.window.Image;
globalShim.HTMLCanvasElement = dom.window.HTMLCanvasElement;
globalShim.getComputedStyle = dom.window.getComputedStyle;

const originalCreateElement = document.createElement.bind(document);
document.createElement = ((
  tagName: string,
  options?: ElementCreationOptions,
) => {
  if (tagName.toLowerCase() === "canvas") {
    return createCanvas(1, 1) as unknown as HTMLCanvasElement;
  }
  return originalCreateElement(tagName, options);
}) as typeof document.createElement;

const PlotlyCore = (await import("plotly.js/lib/core")).default;
const bar = (await import("plotly.js/lib/bar")).default;
const box = (await import("plotly.js/lib/box")).default;
PlotlyCore.register([bar, box]);
const Plotly = PlotlyCore;

const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const snapshotHelpers = require("plotly.js/src/snapshot/helpers");
const originalCreateBlob = snapshotHelpers.createBlob;
const originalCreateObjectURL = snapshotHelpers.createObjectURL;
snapshotHelpers.createBlob = (url: string, format: string) => {
  if (format === "svg") {
    return { __svg: url, type: "image/svg+xml" };
  }
  return originalCreateBlob(url, format);
};
snapshotHelpers.createObjectURL = (blob: { __svg?: string }) => {
  if (blob?.__svg) {
    return snapshotHelpers.encodeSVG(blob.__svg);
  }
  return originalCreateObjectURL(blob);
};
snapshotHelpers.revokeObjectURL = () => {};

const outDir = join("results", "figures");
mkdirSync(outDir, { recursive: true });

const plotFormat = (process.env.PLOT_FORMAT ?? "svg").toLowerCase();
const plotToImage = async (
  filename: string,
  data: Data[],
  layout: Partial<Layout>,
) => {
  const gd = document.createElement("div");
  await Plotly.newPlot(gd, data, layout, { staticPlot: true });
  if (plotFormat === "svg") {
    const svg = (await Plotly.toImage(gd, {
      format: "svg",
      width: 1200,
      height: 600,
      imageDataOnly: true,
    })) as string;
    writeFileSync(join(outDir, filename), svg, "utf8");
  } else {
    const img = (await Plotly.toImage(gd, {
      format: "png",
      width: 1200,
      height: 600,
    })) as string;
    const base64 = img.replace(/^data:image\/png;base64,/, "");
    writeFileSync(join(outDir, filename), base64, "base64");
  }
  Plotly.purge(gd);
};

const rawBy = (keyFn: (r: RawRow) => string) => {
  const m = new Map<string, RawRow[]>();
  for (const r of raw) {
    const k = keyFn(r);
    const arr = m.get(k) ?? [];
    arr.push(r);
    m.set(k, arr);
  }
  return m;
};

const rawByTaskModelAgent = rawBy((r) => `${r.taskId}||${r.model}||${r.agent}`);

const buildMeanStdSeries = (
  metric: keyof RawRow,
  onlySuccess: boolean,
  model: string,
  agent: string,
) => {
  const ys: number[] = [];
  const errs: number[] = [];
  for (const taskId of taskIds) {
    const key = `${taskId}||${model}||${agent}`;
    const rows = rawByTaskModelAgent.get(key) ?? [];
    const filtered = onlySuccess ? rows.filter((r) => r.success) : rows;
    const vals = filtered
      .map((r) => (r[metric] ?? 0) as number)
      .filter((v) => Number.isFinite(v));
    const { mean, std } = meanStd(vals);
    ys.push(mean);
    errs.push(std);
  }
  return { x: taskIds, y: ys, err: errs };
};

const buildMeanStdTable = () => {
  const rows: string[] = [];
  rows.push(
    [
      "taskId",
      "model",
      "agent",
      "n",
      "successRate",
      "durationMeanMs",
      "durationStdMs",
      "totalTokensMean",
      "totalTokensStd",
      "toolCallsMean",
      "toolCallsStd",
      "retriesMean",
      "retriesStd",
    ].join(","),
  );

  for (const taskId of taskIds) {
    for (const model of models) {
      for (const agent of agents) {
        const key = `${taskId}||${model}||${agent}`;
        const rowsForKey = rawByTaskModelAgent.get(key) ?? [];
        const n = rowsForKey.length;
        const k = rowsForKey.filter((r) => r.success).length;
        const rate = n > 0 ? k / n : 0;

        const durationVals = rowsForKey
          .filter((r) => r.success)
          .map((r) => r.durationMs);
        const tokensVals = rowsForKey
          .filter((r) => r.success)
          .map((r) => r.totalTokens ?? 0);
        const toolVals = rowsForKey
          .filter((r) => r.success)
          .map((r) => r.toolCallCount ?? 0);
        const retryVals = rowsForKey
          .filter((r) => r.success)
          .map((r) => r.retries ?? 0);

        const d = meanStd(durationVals);
        const t = meanStd(tokensVals);
        const tc = meanStd(toolVals);
        const rr = meanStd(retryVals);

        rows.push(
          [
            taskId,
            model,
            agent,
            String(n),
            rate.toFixed(4),
            d.mean.toFixed(3),
            d.std.toFixed(3),
            t.mean.toFixed(3),
            t.std.toFixed(3),
            tc.mean.toFixed(3),
            tc.std.toFixed(3),
            rr.mean.toFixed(3),
            rr.std.toFixed(3),
          ].join(","),
        );
      }
    }
  }
  return rows.join("\n");
};

const subplotLayout = (n: number): Partial<Layout> => ({
  grid: { rows: 1, columns: n, pattern: "independent" as const },
  legend: { orientation: "h", y: -0.15 },
  margin: { t: 60, l: 60, r: 20, b: 120 },
});

const setAxis = (layout: Partial<Layout>, axisKey: string, value: unknown) => {
  const mutable = layout as Record<string, unknown>;
  mutable[axisKey] = value;
};

const durationByModelTraces: Data[] = [];
models.forEach((model, idx) => {
  const axisSuffix = idx === 0 ? "" : String(idx + 1);
  agents.forEach((agent) => {
    const { x, y, err } = buildMeanStdSeries("durationMs", true, model, agent);
    durationByModelTraces.push({
      x,
      y,
      name: agent,
      type: "bar",
      error_y: { type: "data", array: err, visible: true },
      xaxis: `x${axisSuffix}`,
      yaxis: `y${axisSuffix}`,
      legendgroup: agent,
      showlegend: idx === 0,
    });
  });
});

const durationLayout: Partial<Layout> = {
  title: { text: "Avg Duration by Task and Agent (Success Only, ±1 SD)" },
  barmode: "group" as const,
  ...subplotLayout(models.length || 1),
};
models.forEach((model, idx) => {
  const axisSuffix = idx === 0 ? "" : String(idx + 1);
  setAxis(durationLayout, `xaxis${axisSuffix}`, { title: model });
  setAxis(durationLayout, `yaxis${axisSuffix}`, {
    title: "ms",
    type: "log",
  });
});

const successByModelTraces: Data[] = [];
models.forEach((model, idx) => {
  const axisSuffix = idx === 0 ? "" : String(idx + 1);
  agents.forEach((agent) => {
    const ys: number[] = [];
    const errPlus: number[] = [];
    const errMinus: number[] = [];
    for (const t of taskIds) {
      const key = `${t}||${model}||${agent}`;
      const ok = successRate.get(key) ?? 0;
      const total = count.get(key) ?? 0;
      const { center, low, high } = wilsonInterval(ok, total);
      ys.push(center);
      errPlus.push(high - center);
      errMinus.push(center - low);
    }
    successByModelTraces.push({
      x: taskIds,
      y: ys,
      name: agent,
      type: "bar",
      error_y: {
        type: "data",
        array: errPlus,
        arrayminus: errMinus,
        visible: true,
      },
      xaxis: `x${axisSuffix}`,
      yaxis: `y${axisSuffix}`,
      legendgroup: agent,
      showlegend: idx === 0,
    });
  });
});

const successLayout: Partial<Layout> = {
  title: { text: "Success Rate by Task and Agent" },
  barmode: "group" as const,
  ...subplotLayout(models.length || 1),
};
models.forEach((model, idx) => {
  const axisSuffix = idx === 0 ? "" : String(idx + 1);
  setAxis(successLayout, `xaxis${axisSuffix}`, { title: model });
  setAxis(successLayout, `yaxis${axisSuffix}`, { range: [0, 1] });
});

const boxTraces: Data[] = agents.map((agent) => ({
  y: successOnly.filter((r) => r.agent === agent).map((r) => r.durationMs),
  name: agent,
  type: "box",
}));

const tokenAvailable = raw.some((r) => (r.totalTokens ?? 0) > 0);
const tokenTraces: Data[] = [];
const tokenLayout: Partial<Layout> = {
  title: { text: "Avg Total Tokens by Task and Agent (Success Only, ±1 SD)" },
  barmode: "group" as const,
  ...subplotLayout(models.length || 1),
};
if (tokenAvailable) {
  models.forEach((model, idx) => {
    const axisSuffix = idx === 0 ? "" : String(idx + 1);
    agents.forEach((agent) => {
      const { x, y, err } = buildMeanStdSeries(
        "totalTokens",
        true,
        model,
        agent,
      );
      tokenTraces.push({
        x,
        y,
        name: agent,
        type: "bar",
        error_y: { type: "data", array: err, visible: true },
        xaxis: `x${axisSuffix}`,
        yaxis: `y${axisSuffix}`,
        legendgroup: agent,
        showlegend: idx === 0,
      });
    });
    setAxis(tokenLayout, `xaxis${axisSuffix}`, { title: model });
    setAxis(tokenLayout, `yaxis${axisSuffix}`, { title: "tokens" });
  });
}

const toolCallsAvailable = raw.some((r) => (r.toolCallCount ?? 0) > 0);
const toolCallTraces: Data[] = [];
const toolCallLayout: Partial<Layout> = {
  title: { text: "Avg Tool Calls by Task and Agent (Success Only, ±1 SD)" },
  barmode: "group" as const,
  ...subplotLayout(models.length || 1),
};
if (toolCallsAvailable) {
  models.forEach((model, idx) => {
    const axisSuffix = idx === 0 ? "" : String(idx + 1);
    agents.forEach((agent) => {
      const { x, y, err } = buildMeanStdSeries(
        "toolCallCount",
        true,
        model,
        agent,
      );
      toolCallTraces.push({
        x,
        y,
        name: agent,
        type: "bar",
        error_y: { type: "data", array: err, visible: true },
        xaxis: `x${axisSuffix}`,
        yaxis: `y${axisSuffix}`,
        legendgroup: agent,
        showlegend: idx === 0,
      });
    });
    setAxis(toolCallLayout, `xaxis${axisSuffix}`, { title: model });
    setAxis(toolCallLayout, `yaxis${axisSuffix}`, { title: "count" });
  });
}

const retriesAvailable = raw.some((r) => (r.retries ?? 0) > 0);
const retriesTraces: Data[] = [];
const retriesLayout: Partial<Layout> = {
  title: { text: "Avg Retries by Task and Agent (Success Only, ±1 SD)" },
  barmode: "group" as const,
  ...subplotLayout(models.length || 1),
};
if (retriesAvailable) {
  models.forEach((model, idx) => {
    const axisSuffix = idx === 0 ? "" : String(idx + 1);
    agents.forEach((agent) => {
      const { x, y, err } = buildMeanStdSeries("retries", true, model, agent);
      retriesTraces.push({
        x,
        y,
        name: agent,
        type: "bar",
        error_y: { type: "data", array: err, visible: true },
        xaxis: `x${axisSuffix}`,
        yaxis: `y${axisSuffix}`,
        legendgroup: agent,
        showlegend: idx === 0,
      });
    });
    setAxis(retriesLayout, `xaxis${axisSuffix}`, { title: model });
    setAxis(retriesLayout, `yaxis${axisSuffix}`, { title: "count" });
  });
}

const imgExt = plotFormat === "svg" ? "svg" : "png";
const withExt = (name: string) => `${name}.${imgExt}`;

const run = async () => {
  await plotToImage(
    withExt("avg_duration_by_task_agent"),
    durationByModelTraces,
    durationLayout,
  );
  await plotToImage(
    withExt("success_rate_by_task_agent"),
    successByModelTraces,
    successLayout,
  );
  await plotToImage(withExt("duration_boxplot_success"), boxTraces, {
    title: { text: "Duration Distribution (Success Only)" },
    margin: { t: 60, l: 60, r: 20, b: 120 },
  });

  if (tokenAvailable) {
    await plotToImage(
      withExt("avg_total_tokens_by_task_agent"),
      tokenTraces,
      tokenLayout,
    );
  }

  if (toolCallsAvailable) {
    await plotToImage(
      withExt("avg_tool_calls_by_task_agent"),
      toolCallTraces,
      toolCallLayout,
    );
  }

  if (retriesAvailable) {
    await plotToImage(
      withExt("avg_retries_by_task_agent"),
      retriesTraces,
      retriesLayout,
    );
  }

  const tableCsv = buildMeanStdTable();
  writeFileSync(join(outDir, "summary_table.csv"), tableCsv, "utf8");

  console.log(`Wrote charts to ${outDir}`);
};

const keepAlive = setInterval(() => {}, 1000);
run()
  .then(() => {
    clearInterval(keepAlive);
  })
  .catch((err) => {
    clearInterval(keepAlive);
    console.error(err);
    process.exitCode = 1;
  });
