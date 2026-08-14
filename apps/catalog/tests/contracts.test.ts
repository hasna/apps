import { describe, expect, it } from "bun:test";
import { AppSchema } from "../src/contracts.js";

const validApp = {
  schema: "hasna.app.v1",
  id: "app_open_todos",
  createdAt: "2026-07-06T08:00:00.000Z",
  appId: "open-alpha",
  npmName: "@example/alpha",
  repoFolder: "open-alpha",
  githubUrl: "https://github.com/example/todos",
  projectSlug: "open-alpha",
  surfaces: {
    bins: ["todos", "todos-cli", "todos-mcp"],
    mcp: { transport: "http", bin: "todos-mcp" },
    http: { healthPath: "/health", port: 4310 },
  },
  lifecycle: "active",
  releaseChannel: "stable",
  summary: "Task and plan tracking for Hasna agents",
  tags: ["distribution", "oss"],
};

describe("vendored hasna.app.v1 mirror", () => {
  it("accepts the foundation valid example", () => {
    const parsed = AppSchema.parse(validApp);
    expect(parsed.appId).toBe("open-alpha");
    expect(parsed.surfaces.mcp?.transport).toBe("http");
  });

  it("applies defaults for surfaces, releaseChannel, and tags", () => {
    const parsed = AppSchema.parse({
      schema: "hasna.app.v1",
      id: "app_open_uptime",
      createdAt: "2026-07-06T08:00:00.000Z",
      appId: "open-beta",
      npmName: "@example/beta",
      repoFolder: "open-beta",
      githubUrl: "https://github.com/example/uptime",
      projectSlug: "open-beta",
      lifecycle: "active",
    });
    expect(parsed.surfaces).toEqual({ bins: [] });
    expect(parsed.releaseChannel).toBe("stable");
    expect(parsed.tags).toEqual([]);
  });

  it("rejects uppercase app ids", () => {
    expect(AppSchema.safeParse({ ...validApp, appId: "Open-Todos" }).success).toBe(false);
  });

  it("rejects non-github urls", () => {
    expect(AppSchema.safeParse({ ...validApp, githubUrl: "https://gitlab.com/hasna/todos" }).success).toBe(false);
  });

  it("rejects duplicate surface bins", () => {
    const result = AppSchema.safeParse({
      ...validApp,
      surfaces: { bins: ["todos", "todos"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys (strict contract)", () => {
    expect(AppSchema.safeParse({ ...validApp, installState: "installed" }).success).toBe(false);
  });
});
