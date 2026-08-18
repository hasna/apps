import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { SystemSnapshot } from "../collectors/local.js";
import { formatCompactStatus, todosTestFailureReason } from "./index.js";

let configDir: string | undefined;

afterEach(() => {
  if (configDir) {
    rmSync(configDir, { recursive: true, force: true });
    configDir = undefined;
  }
});

function makeSnapshot(overrides: Partial<SystemSnapshot> = {}): SystemSnapshot {
  return {
    machineId: "local",
    hostname: "fixture",
    platform: "linux",
    uptime: 60,
    ts: 1,
    cpu: {
      brand: "Fixture CPU",
      cores: 4,
      physicalCores: 2,
      speedGHz: 2.5,
      usagePercent: 12.4,
      loadAvg: [0, 0, 0],
    },
    mem: {
      totalMb: 1024,
      usedMb: 440,
      freeMb: 584,
      usagePercent: 43.2,
      swapTotalMb: 0,
      swapUsedMb: 0,
    },
    disks: [
      {
        fs: "/dev/data",
        type: "ext4",
        mount: "/data",
        totalGb: 200,
        usedGb: 180,
        usagePercent: 90,
      },
      {
        fs: "/dev/root",
        type: "ext4",
        mount: "/",
        totalGb: 100,
        usedGb: 61,
        usagePercent: 61.1,
      },
    ],
    gpus: [],
    processes: [],
    ...overrides,
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function writeConfig(config: unknown): void {
  configDir = mkdtempSync(join(tmpdir(), "monitor-cli-"));
  writeFileSync(join(configDir, "config.json"), JSON.stringify(config));
}

describe("monitor status --compact", () => {
  it("formats a stable single-line summary using the root disk", () => {
    const output = stripAnsi(formatCompactStatus(makeSnapshot()));

    expect(output).toBe("cpu 12% mem 43% disk 61%");
    expect(output).not.toContain("\n");
  });

  it("uses an explicit fallback when no disk is available", () => {
    expect(stripAnsi(formatCompactStatus(makeSnapshot({ disks: [] })))).toBe(
      "cpu 12% mem 43% disk n/a"
    );
  });

  it("runs offline with one non-colored output line", () => {
    const child = spawnSync(
      process.execPath,
      [join(import.meta.dir, "..", "..", "bins", "monitor.ts"), "status", "--compact"],
      { encoding: "utf8", timeout: 30_000 }
    );

    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toMatch(/^cpu \d+% mem \d+% disk (?:\d+%|n\/a)$/);
    expect(child.stdout.trim().split(/\r?\n/)).toHaveLength(1);
    expect(child.stdout).not.toContain("\u001B");
  });
});

describe("monitor compare", () => {
  it("emits one JSON row per configured machine", () => {
    writeConfig({
      machines: [
        { id: "local-a", label: "Local A", type: "local" },
        { id: "local-b", label: "Local B", type: "local" },
      ],
    });

    const result = spawnSync(
      process.execPath,
      ["run", "./bins/monitor.ts", "compare", "--json"],
      {
        cwd: process.cwd(),
        env: { ...process.env, MONITOR_CONFIG_DIR: configDir },
        encoding: "utf-8",
        timeout: 30_000,
      }
    );

    expect(result.status).toBe(0);
    const rows = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.machineId)).toEqual(["local-a", "local-b"]);
    for (const row of rows) {
      expect(typeof row.cpuPercent).toBe("number");
      expect(typeof row.memPercent).toBe("number");
      expect(row.diskPercent === null || typeof row.diskPercent === "number").toBe(true);
      expect(row.error).toBeNull();
    }
  });

  it("resolves explicit machine aliases", () => {
    writeConfig({
      machines: [{ id: "local-a", label: "Local A", type: "local" }],
      aliases: { prod: "local-a" },
    });

    const result = spawnSync(
      process.execPath,
      ["run", "./bins/monitor.ts", "compare", "prod", "--json"],
      {
        cwd: process.cwd(),
        env: { ...process.env, MONITOR_CONFIG_DIR: configDir },
        encoding: "utf-8",
        timeout: 30_000,
      }
    );

    expect(result.status).toBe(0);
    const rows = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.machineId)).toEqual(["local-a"]);
  });
});

describe("monitor integrations test todos", () => {
  it("every run exercises the create endpoint — later runs are not short-circuited by an earlier run's open test task", async () => {
    // Mock todos /v1 server: listTasks returns whatever the mock has
    // "created" so far, exactly like the real server would after a first
    // test run. The command is driven in-process through the real commander
    // action (not a spawned child), so the test is deterministic under load.
    const created: Array<{ id: string; title: string; status: string }> = [];
    let creates = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/v1/tasks") {
          return Response.json({ tasks: created, total: created.length });
        }
        if (req.method === "POST" && url.pathname === "/v1/tasks") {
          creates++;
          const body = (await req.json()) as { title: string };
          const task = {
            id: `mock-${creates}`,
            title: body.title,
            status: "pending",
          };
          created.push(task);
          return Response.json({ task }, { status: 201 });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const todosConfigDir = mkdtempSync(join(tmpdir(), "monitor-cli-todos-"));
    try {
      writeFileSync(
        join(todosConfigDir, "config.json"),
        JSON.stringify({
          machines: [],
          integrations: {
            todos: {
              enabled: true,
              project_id: "proj-test",
              base_url: `http://127.0.0.1:${server.port}`,
            },
          },
        })
      );
      const previousConfigDir = process.env.MONITOR_CONFIG_DIR;
      process.env.MONITOR_CONFIG_DIR = todosConfigDir;

      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      console.log = (...args: unknown[]) => output.push(args.join(" "));
      console.error = (...args: unknown[]) => output.push(args.join(" "));
      try {
        const { program } = await import("./index.js");
        for (let run = 0; run < 2; run++) {
          await program.parseAsync([
            "node",
            "monitor",
            "integrations",
            "test",
            "todos",
          ]);
        }
      } finally {
        console.log = originalLog;
        console.error = originalError;
        if (previousConfigDir === undefined) {
          delete process.env.MONITOR_CONFIG_DIR;
        } else {
          process.env.MONITOR_CONFIG_DIR = previousConfigDir;
        }
      }

      expect(output.join("\n")).toContain("Integration 'todos' test passed.");

      // The first run left an open test task on the mock server. With a fixed
      // test identity the second run would be skipped and still report
      // success — the false-green this regression guards against. Each run
      // carries its own identity, so the second run must reach the create
      // endpoint again.
      expect(creates).toBe(2);
    } finally {
      server.stop(true);
      rmSync(todosConfigDir, { recursive: true, force: true });
    }
  });
});

describe("todosTestFailureReason", () => {
  it("reports the error for a confirmed create failure", () => {
    expect(todosTestFailureReason({ ok: false, error: "boom" })).toBe("boom");
  });

  it("reports a failure when creation was skipped — a skipped test never reports success", () => {
    const reason = todosTestFailureReason({ ok: true, skipped: true });
    expect(reason).toContain("create endpoint was not exercised");
  });

  it("returns undefined when creation was exercised and succeeded", () => {
    expect(todosTestFailureReason({ ok: true })).toBeUndefined();
  });
});
