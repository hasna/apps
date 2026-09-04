import { describe, expect, test } from "bun:test";
import {
  type ChildProcess,
  spawn,
  spawnSync,
} from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const RETRY_LINE = "[logs watch] poll failed, retrying in 100ms";

/**
 * Regression tests for the `logs watch` poll loops (todos 92e024cb): a poll
 * whose store call rejects (SQLite open errors, HTTP/network failures) must
 * print one failure line and keep the watcher alive for the next tick, never
 * die as an unhandled promise rejection.
 */
describe("logs watch poll resilience", () => {
  test("log-tail watch survives a rejecting poll instead of exiting", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "logs-watch-reject-"));
    try {
      // Poison the local SQLite store: the DB path points at a DIRECTORY, so
      // LocalStore.listLogs (searchLogs(getDb(), ...)) rejects on every poll.
      mkdirSync(join(dataDir, "logs.db"));
      const result = spawnSync(
        "bun",
        ["src/cli/index.ts", "watch", "--interval", "100"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            HASNA_LOGS_API_URL: undefined,
            HASNA_LOGS_API_KEY: undefined,
            HASNA_LOGS_LOCAL: "1",
            HASNA_LOGS_DATA_DIR: dataDir,
            HASNA_LOGS_DB_PATH: join(dataDir, "logs.db"),
            LOGS_DATA_DIR: "",
            LOGS_DB_PATH: "",
            HOME: dataDir,
          },
          timeout: 2000,
        },
      );
      // Without the fix the first rejection is an unhandled promise rejection
      // and Bun exits 1 before the timeout. With the fix the watcher is still
      // running when the spawn timeout kills it, and stderr names the failure.
      expect(result.signal).toBe("SIGTERM");
      expect(result.stderr).toContain(RETRY_LINE);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("events watch survives a rejecting poll after a successful baseline", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "logs-watch-events-reject-"));
    let hits = 0;
    const server = createServer((req, res) => {
      hits += 1;
      if (hits === 1) {
        // First poll succeeds: the baseline anchor is established.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ events: [] }));
      } else {
        // Later polls reject with a transient 500.
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "probe-injected-transient" }));
      }
    });
    server.listen(0, "127.0.0.1");
    let child: ChildProcess | undefined;
    try {
      await once(server, "listening");
      const port = (server.address() as { port: number }).port;
      child = spawn(
        "bun",
        ["src/cli/index.ts", "watch", "--events", "--interval", "100"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HASNA_LOGS_API_URL: `http://127.0.0.1:${port}/v1`,
            HASNA_LOGS_API_KEY: "probe-key",
            HASNA_LOGS_DATA_DIR: dataDir,
            HASNA_LOGS_DB_PATH: join(dataDir, "logs.db"),
            LOGS_DATA_DIR: "",
            LOGS_DB_PATH: "",
            HOME: dataDir,
          },
        },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const exited = new Promise<[number | null, NodeJS.Signals | null]>(
        (resolve) => {
          child!.once("exit", (code, signal) => resolve([code, signal]));
        },
      );
      const stillAlive = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 2500)),
      ]);
      if (!stillAlive) {
        child.kill("SIGTERM");
        await exited;
      }
      // Without the fix the first rejecting interval poll is an unhandled
      // promise rejection and Bun exits 1. With the fix the watcher survives
      // past the failing polls and reports the failure for the next tick.
      expect(stillAlive).toBe(true);
      expect(hits).toBeGreaterThan(1);
      expect(stderr).toContain(RETRY_LINE);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      server.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
