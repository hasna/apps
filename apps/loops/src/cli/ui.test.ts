import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { Store } from "../lib/store.js";
import { buildLoopUiSnapshot, renderLoopUiFrame, runLoopsUiApp } from "./ui.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function runCli(dataDir: string, args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: {
      ...process.env,
      LOOPS_DATA_DIR: dataDir,
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_API_KEY: "",
      // Local file store requires the explicit opt-in (fail-closed policy).
      HASNA_LOOPS_CONNECTION: "file",
    },
    encoding: "utf8",
  });
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

describe("loops ui", () => {
  test("builds active loop table rows from loop and run state without output bodies", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-ui-snapshot-"));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop(
        {
          name: "repo-open-loops-worker",
          schedule: { type: "interval", everyMs: 5 * 60_000 },
          target: { type: "agent", provider: "codewith", prompt: "inspect the repo" },
        },
        new Date("2026-07-06T10:00:00.000Z"),
      );
      const succeeded = store.claimRun(loop, "2026-07-06T10:00:00.000Z", "test", new Date("2026-07-06T10:00:00.000Z"));
      expect(succeeded).toBeDefined();
      store.finalizeRun(succeeded!.run.id, {
        status: "succeeded",
        finishedAt: "2026-07-06T10:00:10.000Z",
        durationMs: 10_000,
        stdout: "secret-like output should not render",
        stderr: "",
      });
      const running = store.claimRun(loop, "2026-07-06T10:05:00.000Z", "test", new Date("2026-07-06T10:05:00.000Z"));
      expect(running).toBeDefined();

      store.createLoop(
        {
          name: "daily-shell-check",
          schedule: { type: "cron", expression: "0 9 * * *" },
          target: { type: "command", command: "true" },
        },
        new Date("2026-07-06T10:00:00.000Z"),
      );

      const snapshot = buildLoopUiSnapshot(store, { now: new Date("2026-07-06T10:04:00.000Z") });
      const worker = snapshot.rows.find((row) => row.name === "repo-open-loops-worker");
      expect(worker).toMatchObject({
        status: "active",
        cadence: "every:5m",
        nextRun: "in 1m",
        lastRunOutcome: "running",
        provider: "codewith",
        activeRuns: 1,
      });
      expect(snapshot.stats.activeLoops).toBe(2);
      expect(snapshot.stats.runningRuns).toBe(1);

      const frame = renderLoopUiFrame(snapshot, {
        columns: 110,
        rows: 16,
        color: false,
        refreshMs: 2_000,
      });
      expect(frame).toContain("Loops live loops");
      expect(frame).toContain("ACTIVE-RUNS");
      expect(frame).toContain("repo-open-loops-worker");
      expect(frame).toContain("codewith");
      expect(frame).toContain("every:5m");
      expect(frame).toContain("running");
      expect(frame).not.toContain("secret-like output");

      const narrow = renderLoopUiFrame(snapshot, {
        columns: 60,
        rows: 10,
        color: true,
        refreshMs: 2_000,
      });
      for (const line of stripAnsi(narrow).split("\n")) {
        expect(line.length).toBeLessThanOrEqual(60);
      }
    } finally {
      store.close();
    }
  });

  test("fails clearly outside an interactive terminal", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-ui-nontty-"));
    const result = runCli(dataDir, ["ui"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Loops UI requires a TTY terminal.");
    expect(result.stderr).toContain("loops list");
  });

  test("restores terminal state when rendering fails after startup", async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => NodeJS.ReadStream };
    const output = new PassThrough() as unknown as NodeJS.WriteStream & { columns?: number; rows?: number };
    const rawModes: boolean[] = [];
    let writes = "";
    let closed = false;
    input.setRawMode = (mode: boolean) => {
      rawModes.push(mode);
      return input;
    };
    output.columns = 80;
    output.rows = 24;
    output.on("data", (chunk) => {
      writes += chunk.toString("utf8");
    });
    const store = {
      listLoops() {
        throw new Error("render failed");
      },
      close() {
        closed = true;
      },
    } as unknown as Store;

    await expect(runLoopsUiApp({
      input,
      output,
      storeFactory: () => store,
    })).rejects.toThrow("render failed");

    expect(rawModes).toEqual([true, false]);
    expect(closed).toBe(true);
    expect(writes).toContain("\x1b[?1049h");
    expect(writes).toContain("\x1b[?25h");
    expect(writes).toContain("\x1b[?1049l");
  });

  test("quits and restores terminal state from chunked key input", async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => NodeJS.ReadStream };
    const output = new PassThrough() as unknown as NodeJS.WriteStream & { columns?: number; rows?: number };
    const rawModes: boolean[] = [];
    let writes = "";
    let closed = false;
    input.setRawMode = (mode: boolean) => {
      rawModes.push(mode);
      return input;
    };
    output.columns = 80;
    output.rows = 24;
    output.on("data", (chunk) => {
      writes += chunk.toString("utf8");
    });
    const store = {
      listLoops: () => [],
      listRuns: () => [],
      countLoops: () => 0,
      countRuns: () => 0,
      close() {
        closed = true;
      },
    } as unknown as Store;

    const running = runLoopsUiApp({
      input,
      output,
      storeFactory: () => store,
    });
    input.write("q\r");
    await running;

    expect(rawModes).toEqual([true, false]);
    expect(closed).toBe(true);
    expect(writes).toContain("No active loops.");
    expect(writes).toContain("\x1b[?1049l");
  });

  test("restores terminal state when a resize refresh fails", async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => NodeJS.ReadStream };
    const output = new PassThrough() as unknown as NodeJS.WriteStream & { columns?: number; rows?: number };
    const rawModes: boolean[] = [];
    let writes = "";
    let closed = false;
    let listCalls = 0;
    input.setRawMode = (mode: boolean) => {
      rawModes.push(mode);
      return input;
    };
    output.columns = 80;
    output.rows = 24;
    output.on("data", (chunk) => {
      writes += chunk.toString("utf8");
    });
    const store = {
      listLoops() {
        listCalls += 1;
        if (listCalls > 1) throw new Error("resize failed");
        return [];
      },
      listRuns: () => [],
      countLoops: () => 0,
      countRuns: () => 0,
      close() {
        closed = true;
      },
    } as unknown as Store;

    const running = runLoopsUiApp({
      input,
      output,
      storeFactory: () => store,
    });
    output.emit("resize");
    await expect(running).rejects.toThrow("resize failed");

    expect(rawModes).toEqual([true, false]);
    expect(closed).toBe(true);
    expect(writes).toContain("No active loops.");
    expect(writes).toContain("\x1b[?1049l");
  });
});
