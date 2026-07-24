import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTodosCloudQueryClient,
  createTodosCloudQueryClientFromEnv,
} from "./cloud-client.js";

const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
const originalFallback = process.env.TODOS_STORAGE_MODE;
const originalSqlDescriptor = Object.getOwnPropertyDescriptor(Bun, "SQL");

afterEach(() => {
  if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
  else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
  if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
  else process.env.TODOS_STORAGE_MODE = originalFallback;
  if (originalSqlDescriptor) {
    (Bun as unknown as { SQL: unknown }).SQL = originalSqlDescriptor.value;
  }
});

describe("direct cloud query client authority", () => {
  test("hosted process rejects before options, caller environment, or Bun.SQL", () => {
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let optionReads = 0;
    let environmentReads = 0;
    let sqlReads = 0;
    const options = new Proxy({}, {
      get() {
        optionReads += 1;
        throw new Error("FAKE_ONLY_CLOUD_OPTIONS_MARKER");
      },
    });
    const environment = new Proxy({}, {
      get() {
        environmentReads += 1;
        throw new Error("FAKE_ONLY_CLOUD_ENV_MARKER");
      },
    });
    class ForbiddenSql {
      constructor() {
        sqlReads += 1;
        throw new Error("FAKE_ONLY_BUN_SQL_MARKER");
      }
    }
    (Bun as unknown as { SQL: unknown }).SQL = ForbiddenSql;

    expect(() => createTodosCloudQueryClient("postgres://synthetic.invalid/todos", options))
      .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(() => createTodosCloudQueryClientFromEnv(environment, options))
      .toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect({ optionReads, environmentReads, sqlReads }).toEqual({
      optionReads: 0,
      environmentReads: 0,
      sqlReads: 0,
    });
  });

  test("explicit local authority cannot construct an unscoped remote SQL client", () => {
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    const calls: unknown[][] = [];
    class SyntheticSql {
      constructor(...args: unknown[]) {
        calls.push(args);
      }
      async unsafe(query: string, values: unknown[]) {
        calls.push([query, values]);
        return [{ synthetic: true }];
      }
      async end() {
        calls.push(["end"]);
      }
    }
    (Bun as unknown as { SQL: unknown }).SQL = SyntheticSql;

    expect(() => createTodosCloudQueryClient("postgres://synthetic.invalid/todos", {
      max: 1,
      idleTimeout: 2,
      connectionTimeout: 3,
    })).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(calls).toEqual([]);
  });

  test("a retained SQL client rechecks the authority floor before every query after a mode flip", async () => {
    const buildRoot = mkdtempSync(join(tmpdir(), "todos-cloud-client-warm-"));
    let unsafeCalls = 0;
    let endCalls = 0;
    class SyntheticSql {
      async unsafe() {
        unsafeCalls += 1;
        return [];
      }
      async end() {
        endCalls += 1;
      }
    }
    try {
      const build = await Bun.build({
        entrypoints: [new URL("./cloud-client.ts", import.meta.url).pathname],
        outdir: buildRoot,
        target: "bun",
        format: "esm",
        plugins: [{
          name: "warm-client-construction-harness",
          setup(builder) {
            builder.onLoad({ filter: /cloud-client\.ts$/ }, async ({ path }) => {
              const source = await Bun.file(path).text();
              const functionStart = source.indexOf("export function createTodosCloudQueryClient(");
              const queryStart = source.indexOf("async query", functionStart);
              const guardStart = source.indexOf("  assertStageARemoteClientAuthority();", functionStart);
              if (functionStart < 0 || guardStart < 0 || guardStart > queryStart) {
                throw new Error("cloud client construction harness could not isolate the creation guard");
              }
              const transformed = source.slice(0, guardStart)
                + "  // Construction only is enabled in this bundled test harness.\n"
                + source.slice(guardStart + "  assertStageARemoteClientAuthority();\n".length);
              return { contents: transformed, loader: "ts" };
            });
          },
        }],
      });
      if (!build.success) throw new Error(build.logs.map((entry) => entry.message).join("\n"));
      const entry = build.outputs.find((output) => output.kind === "entry-point");
      if (!entry) throw new Error("warm cloud-client harness produced no entry point");

      process.env.HASNA_TODOS_STORAGE_MODE = "local";
      process.env.TODOS_STORAGE_MODE = "local";
      (Bun as unknown as { SQL: unknown }).SQL = SyntheticSql;
      const module = await import(`${pathToFileURL(entry.path).href}?fixture=${Date.now()}`) as typeof import("./cloud-client.js");
      const client = module.createTodosCloudQueryClient("postgres://synthetic.invalid/todos");

      process.env.HASNA_TODOS_STORAGE_MODE = "remote";
      process.env.TODOS_STORAGE_MODE = "remote";
      await expect(client.query("select must-not-run")).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      await expect(client.close()).rejects.toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
      expect(unsafeCalls).toBe(0);
      expect(endCalls).toBe(0);
    } finally {
      rmSync(buildRoot, { recursive: true, force: true });
    }
  });
});
