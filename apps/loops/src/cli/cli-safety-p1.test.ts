import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { Loop } from "../types.js";
import { Store } from "../lib/store.js";
import { sanitizeCliErrorContext } from "./safe-error-context.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
const FLIP_MESSAGE = "not available while flipped to the hosted Loops API";

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  dataDir: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const merged = {
    ...process.env,
    HOME: dataDir,
    HASNA_LOOPS_API_URL: "",
    HASNA_LOOPS_API_KEY: "",
    HASNA_LOOPS_CONNECTION: "",
    LOOPS_DATA_DIR: dataDir,
    ...env,
  };
  if (!merged.HASNA_LOOPS_CONNECTION?.trim() && !merged.HASNA_LOOPS_API_URL?.trim() && !merged.HASNA_LOOPS_API_KEY?.trim()) {
    // No API env: this spawn runs against the local file store, which requires
    // the explicit opt-in (fail-closed policy).
    merged.HASNA_LOOPS_CONNECTION = "file";
  }
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    env: merged,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

function loopFixture(index: number): Loop {
  const timestamp = "2030-01-01T00:00:00.000Z";
  return {
    id: `hosted-loop-${index.toString().padStart(4, "0")}`,
    name: `hosted-loop-${index.toString().padStart(4, "0")}`,
    labels: [],
    status: "active",
    schedule: { type: "once", at: timestamp },
    target: { type: "command", command: "true" },
    nextRunAt: timestamp,
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 60_000,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("CLI P1 safety regressions", () => {
  test("bounds recursive GateError context projection without leaking string leaves", () => {
    const syntheticSecret = `github_pat_${"Z9y8X7w6".repeat(4)}`;
    const circular: Record<string, unknown> = {
      token: syntheticSecret,
    };
    circular.self = circular;
    class UnsafeContext {
      value = syntheticSecret;
    }
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        throw new Error("must not invoke array getters");
      },
    });
    accessorArray.length = 1;

    const sanitized = sanitizeCliErrorContext({
      code: "VALIDATION_FAILED",
      nested: [{ file: `/tmp/${syntheticSecret}.json` }, circular],
      unsafe: new UnsafeContext(),
      accessorArray,
      huge: "x".repeat(5_000),
    });
    const json = JSON.stringify(sanitized);

    expect(sanitized.code).toBe("VALIDATION_FAILED");
    expect(json).not.toContain(syntheticSecret);
    expect(json).toContain("[SCRUBBED]");
    expect(json).toContain("[circular]");
    expect(json).toContain("[unsupported object]");
    expect(sanitized.accessorArray).toEqual(["[unavailable]"]);
    expect((sanitized.huge as string).length).toBeLessThan(700);
  });

  test("scrubs a synthetic secret from GateError file context before JSON serialization", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-gate-context-"));
    const syntheticSecret = `github_pat_${"Q1w2E3r4".repeat(4)}`;
    const file = join(dataDir, `workflow-${syntheticSecret}.json`);
    writeFileSync(file, "{");
    try {
      const result = await runCli(dataDir, ["--json", "workflows", "validate", file]);
      expect(result.status).toBe(1);
      const value = JSON.parse(result.stdout) as {
        file: string;
        type: string;
        validation: { ok: boolean; code: string; error: string };
      };
      expect(value.type).toBe("workflow");
      expect(value.validation.ok).toBe(false);
      expect(value.validation.code).toBe("VALIDATION_FAILED");
      expect(value.file).toContain("[SCRUBBED]");
      expect(result.stdout).not.toContain(syntheticSecret);
      expect(result.stderr).not.toContain(syntheticSecret);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("uses the same bounded scrubbed message on JSON stdout and stderr", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-safe-error-"));
    const syntheticSecret = `github_pat_${"A1b2C3d4".repeat(4)}`;
    const missingId = `missing-${"x".repeat(1_000)}-${syntheticSecret}`;
    try {
      const result = await runCli(dataDir, ["--json", "show", missingId]);
      expect(result.status).toBe(1);

      const value = JSON.parse(result.stdout) as {
        ok: boolean;
        error: { code: string; message: string };
      };
      expect(value.ok).toBe(false);
      expect(value.error.code).toBe("LOOP_NOT_FOUND");
      expect(value.error.message.length).toBeLessThan(700);
      // The spawned CLI is an explicit-opt-in local run, so stderr carries the
      // resolver's local-mode announcement before the error line; the error
      // line itself is byte-identical to the JSON message.
      const err = result.stderr
        .split("\n")
        .filter((line) => !line.includes("loops: local mode"))
        .join("\n");
      expect(err.trim()).toBe(`error: ${value.error.message}`);
      expect(result.stdout).not.toContain(syntheticSecret);
      expect(result.stderr).not.toContain(syntheticSecret);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("lists every local SQLite loop exactly once beyond the default page", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-list-all-local-"));
    const expectedIds: string[] = [];
    const store = new Store(join(dataDir, "loops.db"));
    try {
      for (let index = 0; index < 205; index += 1) {
        expectedIds.push(store.createLoop({
          name: `local-loop-${index.toString().padStart(4, "0")}`,
          schedule: { type: "once", at: "2030-01-01T00:00:00.000Z" },
          target: { type: "command", command: "true" },
        }).id);
      }
    } finally {
      store.close();
    }

    try {
      const result = await runCli(dataDir, ["--json", "list"]);
      expect(result.status).toBe(0);
      const ids = (JSON.parse(result.stdout) as Array<{ id: string }>).map((loop) => loop.id);
      expect(ids).toHaveLength(expectedIds.length);
      expect(new Set(ids).size).toBe(expectedIds.length);
      expect(ids.toSorted()).toEqual(expectedIds.toSorted());
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("uses loop ids as the total-order tie-breaker for local SQLite list pages", () => {
    const store = new Store(":memory:");
    const from = new Date("2030-01-01T00:00:00.000Z");
    try {
      const ids = ["zeta", "alpha", "middle"].map((name) =>
        store.createLoop({
          name,
          schedule: { type: "once", at: from.toISOString() },
          target: { type: "command", command: "true" },
        }, from).id
      );
      expect(store.listLoops({ limit: 2, offset: 0 }).map((loop) => loop.id)).toEqual(ids.toSorted().slice(0, 2));
      expect(store.listLoops({ limit: 2, offset: 2 }).map((loop) => loop.id)).toEqual(ids.toSorted().slice(2));
    } finally {
      store.close();
    }
  });

  test("paginates hosted list responses, dedupes cross-page ids, and preserves completeness", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-list-all-hosted-"));
    const loops = Array.from({ length: 400 }, (_, index) => loopFixture(index));
    const requestedOffsets: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (request.method !== "GET" || url.pathname !== "/v1/loops") {
          return Response.json({ ok: false, error: "not found" }, { status: 404 });
        }
        const limit = Number(url.searchParams.get("limit") ?? "200");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        requestedOffsets.push(offset);
        const page = offset === 0
          ? loops.slice(0, limit)
          : offset === 200
            ? loops.slice(199, 399)
            : offset === 400
              ? loops.slice(399)
              : [];
        return Response.json({ ok: true, loops: page });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "list"], {
        HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_LOOPS_API_KEY: "test-hosted-key",
      });
      expect(result.status).toBe(0);
      const ids = (JSON.parse(result.stdout) as Array<{ id: string }>).map((loop) => loop.id);
      expect(ids).toHaveLength(loops.length);
      expect(new Set(ids).size).toBe(loops.length);
      expect(ids).toEqual(loops.map((loop) => loop.id));
      expect(requestedOffsets).toEqual([0, 200, 400]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("stops without failing or spinning when a hosted backend repeats a full page", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-list-repeat-hosted-"));
    const page = Array.from({ length: 200 }, (_, index) => loopFixture(index));
    const requestedOffsets: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        requestedOffsets.push(offset);
        return Response.json({ ok: true, loops: page });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "list"], {
        HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_LOOPS_API_KEY: "test-hosted-key",
      });
      expect(result.status).toBe(0);
      const ids = (JSON.parse(result.stdout) as Array<{ id: string }>).map((loop) => loop.id);
      expect(ids).toHaveLength(200);
      expect(new Set(ids).size).toBe(200);
      expect(result.stderr).toContain("repeated a page");
      expect(requestedOffsets).toEqual([0, 200]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("returns the deduplicated population when a hosted page contains no new loop ids", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-list-no-new-hosted-"));
    const page = Array.from({ length: 200 }, (_, index) => loopFixture(index));
    const requestedOffsets: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        requestedOffsets.push(offset);
        // offset 200 returns the same 200 ids REORDERED: every id on the page
        // was already seen on the valid first page, but the page is not an
        // exact repeat, so only the no-new-ids detector can catch it.
        return Response.json({ ok: true, loops: offset === 0 ? page : [...page].reverse() });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "list"], {
        HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_LOOPS_API_KEY: "test-hosted-key",
      });
      expect(result.status).toBe(0);
      const ids = (JSON.parse(result.stdout) as Array<{ id: string }>).map((loop) => loop.id);
      expect(ids).toHaveLength(200);
      expect(new Set(ids).size).toBe(200);
      expect(result.stderr).toContain("no new loop ids");
      expect(requestedOffsets).toEqual([0, 200]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("stops at a no-progress page after valid prior pages without failing or spinning", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-list-late-dup-hosted-"));
    const all = Array.from({ length: 400 }, (_, index) => loopFixture(index));
    const requestedOffsets: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        requestedOffsets.push(offset);
        if (offset === 0) return Response.json({ ok: true, loops: all.slice(0, 200) });
        if (offset === 200) return Response.json({ ok: true, loops: all.slice(200, 400) });
        // offset 400: a full page made up only of ids already seen on the two
        // valid prior pages, reordered so it is not an exact repeat.
        return Response.json({ ok: true, loops: all.slice(0, 200).reverse() });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "list"], {
        HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_LOOPS_API_KEY: "test-hosted-key",
      });
      expect(result.status).toBe(0);
      const ids = (JSON.parse(result.stdout) as Array<{ id: string }>).map((loop) => loop.id);
      expect(ids).toHaveLength(400);
      expect(new Set(ids).size).toBe(400);
      expect(result.stderr).toContain("no new loop ids");
      expect(requestedOffsets).toEqual([0, 200, 400]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted list with an empty population exits 0 with an empty result", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-list-empty-hosted-"));
    const requestedOffsets: number[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requestedOffsets.push(Number(url.searchParams.get("offset") ?? "0"));
        return Response.json({ ok: true, loops: [] });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "list"], {
        HASNA_LOOPS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_LOOPS_API_KEY: "test-hosted-key",
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([]);
      expect(requestedOffsets).toEqual([0]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted daemon stop, install, and logs fail before local side effects", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-cli-hosted-daemon-guard-"));
    const dataDir = join(root, "data");
    const home = join(root, "home");
    const binDir = join(root, "bin");
    const pidPath = join(dataDir, "daemon.pid");
    const logPath = join(dataDir, "daemon.log");
    const enableMarker = join(root, "startup-enable-called");
    const servicePath = process.platform === "darwin"
      ? join(home, "Library", "LaunchAgents", "com.hasna.loops.daemon.plist")
      : join(home, ".config", "systemd", "user", "loops-daemon.service");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(pidPath, "999999999");
    writeFileSync(logPath, "LOCAL_DAEMON_LOG_MUST_NOT_BE_READ\n");
    for (const command of ["systemctl", "launchctl"]) {
      const path = join(binDir, command);
      writeFileSync(path, "#!/bin/sh\nprintf called >> \"$LOOPS_TEST_ENABLE_MARKER\"\nexit 0\n");
      chmodSync(path, 0o755);
    }
    const env = {
      HOME: home,
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "test-hosted-key",
      LOOPS_DATA_DIR: dataDir,
      LOOPS_TEST_ENABLE_MARKER: enableMarker,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    };

    try {
      const stop = await runCli(dataDir, ["daemon", "stop"], env);
      const install = await runCli(dataDir, ["daemon", "install", "--enable"], env);
      const logs = await runCli(dataDir, ["daemon", "logs"], env);

      for (const result of [stop, install, logs]) {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(FLIP_MESSAGE);
        expect(result.stdout).not.toContain("test-hosted-key");
        expect(result.stderr).not.toContain("test-hosted-key");
      }
      expect(existsSync(pidPath)).toBe(true);
      expect(readFileSync(pidPath, "utf8")).toBe("999999999");
      expect(existsSync(servicePath)).toBe(false);
      expect(existsSync(enableMarker)).toBe(false);
      expect(logs.stdout).not.toContain("LOCAL_DAEMON_LOG_MUST_NOT_BE_READ");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
