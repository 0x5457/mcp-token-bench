import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadTasks = async () => {
  const mod = await import("../src/tasks.js");
  return mod.tasks;
};

describe("tasks", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_OWNER", "acme");
    vi.stubEnv("GITHUB_REPO", "infra");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses env vars for GitHub tasks", async () => {
    const tasks = await loadTasks();
    const listTask = tasks.find((task) => task.id === "github.list.repo");
    const searchTask = tasks.find((task) => task.id === "github.search.code");

    expect(listTask?.args).toMatchObject({ owner: "acme", repo: "infra" });
    expect(searchTask?.args).toMatchObject({ query: "repo:acme/infra mcp" });
  });

  it("falls back to defaults when env is unset", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_OWNER", "");
    vi.stubEnv("GITHUB_REPO", "");
    vi.resetModules();

    const tasks = await loadTasks();
    const listTask = tasks.find((task) => task.id === "github.list.repo");

    expect(listTask?.args).toMatchObject({ owner: "github", repo: "github-mcp-server" });
  });
});
