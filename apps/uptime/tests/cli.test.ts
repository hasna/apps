import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCli(args: string[], dbPath: string, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, HASNA_UPTIME_DB: dbPath, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("CLI init, add, and list work with JSON output", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const init = runCli(["init", "--json"], dbPath);
    const add = runCli(["add", "api", "--url", "https://example.com", "--json"], dbPath);
    const list = runCli(["list", "--all", "--json"], dbPath);

    expect(init.exitCode).toBe(0);
    expect(add.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    const monitors = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(monitors).toHaveLength(1);
    expect(monitors[0].name).toBe("api");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI data commands stay local when hosted env vars are set", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const env = { HASNA_UPTIME_MODE: "hosted", HASNA_UPTIME_HOSTED_TOKEN: "hosted-secret" };
    const init = runCli(["init", "--json"], dbPath, env);
    const add = runCli(["add", "api", "--url", "https://example.com", "--json"], dbPath, env);
    const list = runCli(["list", "--all", "--json"], dbPath, env);

    expect(init.exitCode).toBe(0);
    expect(add.exitCode).toBe(0);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(list.stdout))).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI update changes monitor configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    runCli(["init", "--json"], dbPath);
    runCli(["add", "api", "--url", "https://example.com", "--json"], dbPath);
    const update = runCli([
      "update",
      "api",
      "--method",
      "head",
      "--expected-status",
      "204",
      "--interval",
      "30",
      "--json",
    ], dbPath);

    expect(update.exitCode).toBe(0);
    const monitor = JSON.parse(new TextDecoder().decode(update.stdout));
    expect(monitor.method).toBe("HEAD");
    expect(monitor.expectedStatus).toBe(204);
    expect(monitor.intervalSeconds).toBe(30);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI add rejects conflicting HTTP and TCP targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const result = runCli(["add", "bad", "--url", "https://example.com", "--tcp", "127.0.0.1", "--port", "80", "--json"], dbPath);
    const body = JSON.parse(new TextDecoder().decode(result.stdout));

    expect(result.exitCode).toBe(1);
    expect(body.error).toContain("Choose either --url or --tcp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI rejects control characters in monitor names", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const result = runCli(["add", "bad\nname", "--url", "https://example.com", "--json"], dbPath);
    const body = JSON.parse(new TextDecoder().decode(result.stdout));

    expect(result.exitCode).toBe(1);
    expect(body.error).toContain("control characters");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI report dry-run prints a report without delivery configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    runCli(["add", "api", "--url", "https://example.com"], dbPath);
    const result = runCli(["report", "--dry-run"], dbPath);
    const stdout = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("Open Uptime report");
    expect(stdout).toContain("api");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI imports preview and apply manual records", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const record = JSON.stringify({
      sourceId: "api",
      monitor: { name: "api import", kind: "http", url: "https://example.com/health" },
    });
    const preview = runCli(["imports", "preview", "--source", "manual", "--record", record, "--json"], dbPath);
    const apply = runCli(["imports", "apply", "--source", "manual", "--record", record, "--json"], dbPath);
    const list = runCli(["list", "--all", "--json"], dbPath);

    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(preview.stdout)).totals.create).toBe(1);
    expect(apply.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(apply.stdout)).batchId).toStartWith("imp_");
    expect(JSON.parse(new TextDecoder().decode(list.stdout))[0].name).toBe("api import");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
