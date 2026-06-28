import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveUptime } from "../src/api.js";

function runCli(args: string[], dbPath: string, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, HASNA_UPTIME_DB: dbPath, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function runCliAsync(args: string[], dbPath: string, env: Record<string, string> = {}) {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, HASNA_UPTIME_DB: dbPath, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout: new Uint8Array(stdout),
    stderr: new Uint8Array(stderr),
  };
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

test("CLI cloud plan emits blocked dry-run JSON without live mutation commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const result = runCli(["cloud", "plan", "--json"], dbPath);
    const stdout = new TextDecoder().decode(result.stdout);
    const plan = JSON.parse(stdout);

    expect(result.exitCode).toBe(0);
    expect(plan.status).toBe("blocked");
    expect(plan.canApply).toBe(false);
    expect(plan.safety.liveAwsMutation).toBe(false);
    expect(stdout).not.toContain("aws ecr create-repository");
    expect(stdout).not.toContain("aws s3api create-bucket");
    expect(stdout).not.toContain("aws ecs create-cluster");
    expect(stdout).not.toContain("docker push ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI Spark01 env requires a real cloud probe id", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const missing = runCli(["cloud", "spark01-config", "--env"], dbPath);
    const ok = runCli(["cloud", "spark01-config", "--probe-id", "prb_spark01", "--env"], dbPath);
    const stderr = new TextDecoder().decode(missing.stderr);
    const stdout = new TextDecoder().decode(ok.stdout);

    expect(missing.exitCode).toBe(1);
    expect(stderr).toContain("HASNA_UPTIME_PRIVATE_PROBE_ID");
    expect(ok.exitCode).toBe(0);
    expect(stdout).toContain("HASNA_UPTIME_PRIVATE_PROBE_ID=prb_spark01");
    expect(stdout).toContain("HASNA_UPTIME_MODE=hosted");
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

test("CLI report-schedules create, run-due, runs, and audit work", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const env = { HASNA_MAILERY_SEND_KEY: "", MAILERY_SEND_KEY: "", ESK: "" };
    runCli(["add", "api", "--url", "https://example.com"], dbPath);
    const create = runCli([
      "report-schedules",
      "create",
      "ops",
      "--interval",
      "60",
      "--next-run-at",
      "2026-01-01T00:00:00.000Z",
      "--email",
      "ops@example.com",
      "--from",
      "ops@example.com",
      "--json",
    ], dbPath, env);
    const list = runCli(["report-schedules", "list", "--all", "--json"], dbPath, env);
    const due = runCli([
      "report-schedules",
      "run-due",
      "--now",
      "2026-01-01T00:00:00.000Z",
      "--json",
    ], dbPath, env);
    const runs = runCli(["report-schedules", "runs", "--json"], dbPath, env);
    const audit = runCli(["audit", "--json"], dbPath, env);

    expect(create.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(create.stdout)).name).toBe("ops");
    expect(JSON.parse(new TextDecoder().decode(list.stdout))).toHaveLength(1);
    expect(due.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(due.stdout))[0].status).toBe("failed");
    expect(JSON.parse(new TextDecoder().decode(runs.stdout))).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(audit.stdout)).map((event: any) => event.action)).toContain("report_schedule.run");
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

test("CLI creates probes, claims jobs, and submits signed results", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const keyPath = join(dir, "probe.key.pem");
    const add = runCli(["add", "private-api", "--url", "https://example.com/health", "--json"], dbPath);
    const monitor = JSON.parse(new TextDecoder().decode(add.stdout));
    const createProbe = runCli(["probes", "create", "spark01", "--private-key-file", keyPath, "--json"], dbPath);
    const probe = JSON.parse(new TextDecoder().decode(createProbe.stdout));
    const createJob = runCli([
      "probes",
      "jobs",
      "create",
      "--monitor",
      monitor.id,
      "--schedule-slot",
      "cli-slot-1",
      "--json",
    ], dbPath);
    const job = JSON.parse(new TextDecoder().decode(createJob.stdout));
    const claimJob = runCli(["probes", "jobs", "claim", job.id, "--probe", probe.id, "--json"], dbPath);
    const claimed = JSON.parse(new TextDecoder().decode(claimJob.stdout));
    const submit = runCli([
      "probes",
      "submit",
      "--probe",
      probe.id,
      "--job",
      claimed.id,
      "--schedule-slot",
      claimed.scheduleSlot,
      "--fencing-token",
      claimed.fencingToken,
      "--monitor",
      monitor.id,
      "--private-key-file",
      keyPath,
      "--status",
      "down",
      "--nonce",
      "cli-nonce-1",
      "--checked-at",
      new Date().toISOString(),
      "--latency",
      "51",
      "--status-code",
      "503",
      "--error",
      "service unavailable",
      "--attempts",
      "2",
      "--monitor-revision",
      String(monitor.revision),
      "--json",
    ], dbPath);
    const body = JSON.parse(new TextDecoder().decode(submit.stdout));
    const results = runCli(["results", "--json"], dbPath);

    expect(add.exitCode).toBe(0);
    expect(createProbe.exitCode).toBe(0);
    expect(probe.privateKeyPem).toBeUndefined();
    expect(probe.privateKeyFile).toBe(keyPath);
    expect(createJob.exitCode).toBe(0);
    expect(claimJob.exitCode).toBe(0);
    expect(submit.exitCode).toBe(0);
    expect(claimed.fencingToken).toBeTruthy();
    expect(body.result.status).toBe("down");
    expect(body.receipt.jobId).toBe(claimed.id);
    expect(JSON.parse(new TextDecoder().decode(results.stdout))[0].status).toBe("down");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI probe create does not register identity when generated key file cannot be written", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const existingKeyPath = join(dir, "existing.key.pem");
    const retryKeyPath = join(dir, "retry.key.pem");
    writeFileSync(existingKeyPath, "already here");

    const failed = runCli(["probes", "create", "spark01", "--private-key-file", existingKeyPath, "--json"], dbPath);
    const listAfterFailure = runCli(["probes", "list", "--all", "--json"], dbPath);
    const retry = runCli(["probes", "create", "spark01", "--private-key-file", retryKeyPath, "--json"], dbPath);
    const listAfterRetry = runCli(["probes", "list", "--all", "--json"], dbPath);

    expect(failed.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(failed.stdout)).error).toContain("EEXIST");
    expect(JSON.parse(new TextDecoder().decode(listAfterFailure.stdout))).toHaveLength(0);
    expect(retry.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(listAfterRetry.stdout))).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI submits signed probe results to a served local API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  let runtime: ReturnType<typeof serveUptime> | undefined;
  try {
    const dbPath = join(dir, "uptime.db");
    const keyPath = join(dir, "remote-probe.key.pem");
    runtime = serveUptime({ dbPath, port: 0, apiToken: "secret" });
    const baseUrl = `http://${runtime.server.hostname}:${runtime.server.port}`;
    const add = runCli(["add", "remote-api", "--url", "https://example.com/health", "--json"], dbPath);
    const monitor = JSON.parse(new TextDecoder().decode(add.stdout));
    const createProbe = runCli(["probes", "create", "spark01", "--private-key-file", keyPath, "--json"], dbPath);
    const probe = JSON.parse(new TextDecoder().decode(createProbe.stdout));
    const createJob = runCli([
      "probes",
      "jobs",
      "create",
      "--monitor",
      monitor.id,
      "--schedule-slot",
      "cli-remote-slot-1",
      "--json",
    ], dbPath);
    const job = JSON.parse(new TextDecoder().decode(createJob.stdout));
    const claimJob = runCli(["probes", "jobs", "claim", job.id, "--probe", probe.id, "--json"], dbPath);
    const claimed = JSON.parse(new TextDecoder().decode(claimJob.stdout));
    const submit = await runCliAsync([
      "probes",
      "submit",
      "--api-url",
      baseUrl,
      "--token",
      "secret",
      "--probe",
      probe.id,
      "--job",
      claimed.id,
      "--schedule-slot",
      claimed.scheduleSlot,
      "--fencing-token",
      claimed.fencingToken,
      "--monitor",
      monitor.id,
      "--private-key-file",
      keyPath,
      "--status",
      "up",
      "--nonce",
      "cli-remote-nonce-1",
      "--checked-at",
      new Date().toISOString(),
      "--latency",
      "21",
      "--status-code",
      "200",
      "--monitor-revision",
      String(claimed.monitorRevision),
      "--json",
    ], dbPath);
    const body = JSON.parse(new TextDecoder().decode(submit.stdout));

    expect(submit.exitCode).toBe(0);
    expect(body.result.status).toBe("up");
    expect(runtime.service.listResults()).toHaveLength(1);
  } finally {
    runtime?.server.stop(true);
    runtime?.service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
