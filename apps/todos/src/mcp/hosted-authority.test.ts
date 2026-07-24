import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";
import {
  handleMcpHttpRequest,
  readinessResponse,
  resolveStartHttpServerOptions,
  startHttpServer,
} from "./http.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runStdioEntrypoint(args: string[]) {
  const root = mkdtempSync(join(tmpdir(), "todos-mcp-hosted-"));
  tempRoots.push(root);
  const dbPath = join(root, "todos.db");
  const proc = Bun.spawn(["bun", "run", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_STORAGE_MODE: "self_hosted",
      HASNA_TODOS_SHADOW: "1",
      HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const result = await Promise.race([
    proc.exited.then((exitCode) => ({ exitCode, timedOut: false })),
    Bun.sleep(3_000).then(() => ({ exitCode: -1, timedOut: true })),
  ]);
  if (result.timedOut) proc.kill();
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return {
    ...result,
    stdout,
    stderr,
    dbExists: existsSync(dbPath),
    sqliteArtifacts: readdirSync(root).filter((name) => /(?:\.db|\.sqlite)(?:-|$)/.test(name)),
  };
}

describe("MCP Stage-A hosted containment", () => {
  test("hosted MCP construction reaches the process floor before hostile options", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    let reads = 0;
    const options = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_MCP_OPTION_GETTER_MARKER");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FAKE_ONLY_MCP_OPTION_OWN_KEYS_MARKER");
      },
    });
    try {
      expect(() => buildServer(options)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
    }
  });

  test("hosted MCP HTTP startup reaches the process floor before hostile options", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let reads = 0;
    const options = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_MCP_HTTP_OPTION_GETTER_MARKER");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FAKE_ONLY_MCP_HTTP_OPTION_KEYS_MARKER");
      },
    });
    try {
      expect(() => resolveStartHttpServerOptions(options)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("MCP HTTP option and environment accessors are rejected without invocation", () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let reads = 0;
    const environment = Object.defineProperty({}, "HASNA_TODOS_STORAGE_MODE", {
      enumerable: true,
      get() {
        reads += 1;
        return "local";
      },
    }) as NodeJS.ProcessEnv;
    const options = Object.defineProperty({}, "environment", {
      enumerable: true,
      get() {
        reads += 1;
        return environment;
      },
    });
    try {
      expect(() => resolveStartHttpServerOptions(options)).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(reads).toBe(0);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("a process-role denial during option snapshot prevents the MCP listener", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    const originalServe = Bun.serve;
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    let serveCalls = 0;
    const options = new Proxy({
      name: "todos",
      environment: {
        HASNA_TODOS_STORAGE_MODE: "local",
        TODOS_STORAGE_MODE: "local",
      },
    }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "name") {
          process.env.HASNA_TODOS_STORAGE_MODE = "remote";
          process.env.TODOS_STORAGE_MODE = "remote";
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    (Bun as unknown as { serve: typeof Bun.serve }).serve = ((..._args: Parameters<typeof Bun.serve>) => {
      serveCalls += 1;
      throw new Error("FAKE_ONLY_MCP_LISTENER_STARTED");
    }) as typeof Bun.serve;
    try {
      await expect(startHttpServer(19429, options)).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(serveCalls).toBe(0);
    } finally {
      (Bun as unknown as { serve: typeof Bun.serve }).serve = originalServe;
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("hosted stdio construction fails before any datastore tool is registered", () => {
    expect(() => buildServer({ environment: { HASNA_TODOS_STORAGE_MODE: "remote" } }))
      .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
  });

  test("explicit local construction stays available even with a shadow DSN", () => {
    expect(buildServer({
      environment: {
        HASNA_TODOS_STORAGE_MODE: "local",
        HASNA_TODOS_SHADOW: "1",
        HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/todos",
      },
    })).toBeDefined();
  });

  test("MCP construction re-evaluates a local-to-hosted role flip", () => {
    const environment = { HASNA_TODOS_STORAGE_MODE: "local" };
    expect(buildServer({ environment })).toBeDefined();
    environment.HASNA_TODOS_STORAGE_MODE = "remote";
    expect(() => buildServer({ environment })).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
  });

  test("MCP HTTP returns 503 before constructing a server", async () => {
    const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallback = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "self_hosted";
    process.env.TODOS_STORAGE_MODE = "self_hosted";
    try {
      const response = await handleMcpHttpRequest(
        new Request("https://todos.example.test/mcp", { method: "POST" }),
      );
      expect(response.status).toBe(503);
    } finally {
      if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
      if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallback;
    }
  });

  test("MCP HTTP readiness fails hosted and succeeds explicit local", async () => {
    const hosted = readinessResponse("todos", { HASNA_TODOS_STORAGE_MODE: "remote" });
    expect(hosted.status).toBe(503);
    expect(await hosted.json()).toMatchObject({ status: "unavailable", code: "HOSTED_AUTHORITY_UNAVAILABLE" });

    const local = readinessResponse("todos", {
      HASNA_TODOS_STORAGE_MODE: "local",
      HASNA_TODOS_DATABASE_URL: "postgres://synthetic.invalid/shadow",
    });
    expect(local.status).toBe(200);
  });

  test("hosted readiness reaches the process floor before a hostile supplied environment", async () => {
    const originalHasnaMode = process.env.HASNA_TODOS_STORAGE_MODE;
    const originalFallbackMode = process.env.TODOS_STORAGE_MODE;
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let reads = 0;
    const environment = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_MCP_READINESS_ENV_MARKER");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FAKE_ONLY_MCP_READINESS_ENV_KEYS_MARKER");
      },
    }) as NodeJS.ProcessEnv;
    try {
      const response = readinessResponse("todos", environment);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "HOSTED_AUTHORITY_UNAVAILABLE" });
      expect(reads).toBe(0);
    } finally {
      if (originalHasnaMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
      else process.env.HASNA_TODOS_STORAGE_MODE = originalHasnaMode;
      if (originalFallbackMode === undefined) delete process.env.TODOS_STORAGE_MODE;
      else process.env.TODOS_STORAGE_MODE = originalFallbackMode;
    }
  });

  test.each([
    ["bare MCP entrypoint", ["src/mcp/index.ts"]],
    ["CLI mcp entrypoint", ["src/cli/index.tsx", "mcp"]],
  ] as const)("%s exits before SQLite, shadow drain, or tool startup", async (_label, args) => {
    const result = await runStdioEntrypoint(args as unknown as string[]);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    expect(combinedOutput).toContain("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(combinedOutput.match(/HOSTED_AUTHORITY_UNAVAILABLE/g)).toHaveLength(1);
    expect(result.dbExists).toBe(false);
    expect(result.sqliteArtifacts).toEqual([]);
  });
});
