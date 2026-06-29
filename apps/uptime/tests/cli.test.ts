import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveUptime } from "../src/api.js";
import { runEdgeSmoke } from "../src/edge-smoke.js";

function runCli(args: string[], dbPath: string, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    cwd: process.cwd(),
    env: { ...process.env, HASNA_UPTIME_DB: dbPath, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function runBuiltCli(args: string[], dbPath: string, env: Record<string, string> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "dist/cli/index.js", ...args],
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

test("built CLI serve rejects raw hosted token when NODE_ENV is production", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const result = runBuiltCli([
      "serve",
      "--mode",
      "hosted",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--hosted-sqlite-db",
      join(dir, "hosted.db"),
      "--allow-hosted-local-store",
    ], dbPath, {
      NODE_ENV: "production",
      HASNA_UPTIME_HOSTED_AUTH_MODE: "",
      HASNA_UPTIME_HOSTED_TOKEN: "raw-broad",
      HASNA_UPTIME_HOSTED_TOKENS: "",
    });
    const stderr = new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain("scoped hosted token JSON");
    expect(stderr).not.toContain("Open Uptime listening");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud plan emits blocked dry-run JSON without live mutation commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const result = runCli(["cloud", "plan", "--runtime-package-integrity", "sha512-exampleIntegrity==", "--json"], dbPath);
    const stdout = new TextDecoder().decode(result.stdout);
    const plan = JSON.parse(stdout);

    expect(result.exitCode).toBe(0);
    expect(plan.status).toBe("blocked");
    expect(plan.canApply).toBe(false);
    expect(plan.image.expectedIntegrity).toBe("sha512-exampleIntegrity==");
    expect(plan.safety.liveAwsMutation).toBe(false);
    expect(stdout).not.toContain("aws ecr create-repository");
    expect(stdout).not.toContain("aws s3api create-bucket");
    expect(stdout).not.toContain("aws ecs create-cluster");
    expect(stdout).not.toContain("docker push ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud postgres-plan emits redacted blocked schema plan and SQL", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const jsonResult = runCli([
      "cloud",
      "postgres-plan",
      "--database-url",
      "postgres://svc:raw-password@db.example.invalid/uptime?sslmode=require",
      "--json",
    ], dbPath);
    const sqlResult = runCli(["cloud", "postgres-plan", "--schema", "uptime_prod", "--sql"], dbPath);
    const jsonStdout = new TextDecoder().decode(jsonResult.stdout);
    const sqlStdout = new TextDecoder().decode(sqlResult.stdout);
    const plan = JSON.parse(jsonStdout);

    expect(jsonResult.exitCode).toBe(0);
    expect(plan.status).toBe("blocked");
    expect(plan.canApply).toBe(false);
    expect(plan.database.redactedUrl).toBe("postgres://user:redacted@db.example.invalid/uptime");
    expect(jsonStdout).not.toContain("raw-password");
    expect(jsonStdout).not.toContain("sslmode=require");
    expect(sqlResult.exitCode).toBe(0);
    expect(sqlStdout).toContain("CREATE TABLE IF NOT EXISTS \"uptime_prod\".\"sync_tombstones\"");
    expect(sqlStdout).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sqlStdout).not.toContain("postgres://");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI private probe env requires a real cloud probe id", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const missing = runCli(["cloud", "private-probe-config", "--env"], dbPath);
    const blocked = runCli(["cloud", "private-probe-config", "--probe-id", "prb_private_01", "--env"], dbPath);
    const ok = runCli(["cloud", "private-probe-config", "--probe-id", "prb_private_01", "--env", "--allow-blocked-env"], dbPath);
    const stderr = new TextDecoder().decode(missing.stderr);
    const blockedStderr = new TextDecoder().decode(blocked.stderr);
    const stdout = new TextDecoder().decode(ok.stdout);

    expect(missing.exitCode).toBe(1);
    expect(stderr).toContain("private probe env output is blocked");
    expect(blocked.exitCode).toBe(1);
    expect(blockedStderr).toContain("private probe env output is blocked");
    expect(ok.exitCode).toBe(0);
    expect(stdout).toContain("HASNA_UPTIME_PRIVATE_PROBE_ID=prb_private_01");
    expect(stdout).toContain("HASNA_UPTIME_MODE=hosted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI hosted public-check command is workspace scoped and bounded", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const missingWorkspace = runCli([
      "cloud",
      "public-checks",
      "run-due",
      "--hosted-sqlite-db",
      dbPath,
      "--allow-hosted-local-store",
      "--json",
    ], dbPath, { HASNA_UPTIME_WORKSPACE_ID: "" });
    const ok = runCli([
      "cloud",
      "public-checks",
      "run-due",
      "--workspace-id",
      "ws_cli",
      "--hosted-sqlite-db",
      dbPath,
      "--allow-hosted-local-store",
      "--json",
    ], dbPath, { HASNA_UPTIME_WORKSPACE_ID: "" });

    expect(missingWorkspace.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(missingWorkspace.stdout)).error).toContain("workspace id");
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(ok.stdout))).toMatchObject({ ok: true, workspaceId: "ws_cli", checked: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI hosted worker entrypoints preflight and fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const env = {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_COMPONENT: "public-probe",
      HASNA_UPTIME_WORKSPACE_ID: "ws_cli",
    };
    const preflight = runCli(["cloud", "workers", "preflight", "--role", "public-probe", "--json"], dbPath, env);
    const healthcheck = runCli(["cloud", "workers", "preflight", "--role", "public-probe", "--healthcheck", "--json"], dbPath, env);
    const badHealthcheck = runCli(["cloud", "workers", "preflight", "--role", "public-probe", "--healthcheck", "--json"], dbPath, {
      ...env,
      HASNA_UPTIME_COMPONENT: "reporter",
    });
    const run = runCli(["cloud", "workers", "run", "--role", "public-probe", "--json"], dbPath, env);

    expect(preflight.exitCode).toBe(0);
    expect(healthcheck.exitCode).toBe(0);
    expect(badHealthcheck.exitCode).toBe(1);
    const preflightJson = JSON.parse(new TextDecoder().decode(preflight.stdout));
    expect(preflightJson).toMatchObject({
      kind: "open-uptime.hosted-worker-preflight",
      role: "public-probe",
      status: "blocked",
      canStart: false,
      workspaceId: "ws_cli",
    });
    expect(preflightJson.blockers.join("\n")).toContain("public-probe-job-claims");
    expect(preflightJson.blockers.join("\n")).toContain("cloud-worker-leases");

    expect(run.exitCode).toBe(1);
    const runJson = JSON.parse(new TextDecoder().decode(run.stdout));
    expect(runJson.ok).toBe(false);
    expect(runJson.preflight.role).toBe("public-probe");
    expect(runJson.error).toContain("blocked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI reporter preflight validates hosted report channel refs while staying blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const env = {
      HASNA_UPTIME_MODE: "hosted",
      HASNA_UPTIME_COMPONENT: "reporter",
      HASNA_UPTIME_WORKSPACE_ID: "ws_cli",
      HASNA_UPTIME_REPORT_CHANNEL_REFS_JSON: JSON.stringify({
        version: "open-uptime.report-channel-refs.v1",
        channels: [
          {
            id: "ops-email",
            channel: "email",
            service: "mailery",
            secretRef: "arn:aws:secretsmanager:us-east-1:123456789012:secret:open-uptime/prod/reporting-email",
            targetRef: "ops",
          },
          {
            id: "ops-logs",
            channel: "logs",
            service: "logs",
            secretRef: "arn:aws:ssm:us-east-1:123456789012:parameter/open-uptime/prod/reporting/logs",
            targetRef: "open-uptime",
          },
        ],
      }),
    };
    const preflight = runCli(["cloud", "workers", "preflight", "--role", "reporter", "--json"], dbPath, env);
    const body = JSON.parse(new TextDecoder().decode(preflight.stdout));
    const channelRefs = body.checks.find((check: any) => check.name === "cloud-channel-refs");

    expect(preflight.exitCode).toBe(0);
    expect(body).toMatchObject({
      role: "reporter",
      status: "blocked",
      canStart: false,
      workspaceId: "ws_cli",
    });
    expect(channelRefs).toMatchObject({ ok: true });
    expect(channelRefs.detail).toContain("email=1");
    expect(channelRefs.detail).toContain("logs=1");
    expect(body.blockers.join("\n")).toContain("postgres-adapter");
    expect(body.blockers.join("\n")).toContain("cloud-worker-leases");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud edge-smoke verifies hosted auth, fail-closed routes, mutation cleanup, and direct-origin denial", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  let runtime: ReturnType<typeof serveUptime> | undefined;
  let directOrigin: ReturnType<typeof Bun.serve> | undefined;
  try {
    const dbPath = join(dir, "uptime.db");
    runtime = serveUptime({
      mode: "hosted",
      hostedSqliteDbPath: dbPath,
      allowHostedLocalStore: true,
      port: 0,
      hostedTokens: [
        { token: "read-secret", scopes: ["uptime:read"], workspaceId: "ws_cli", actor: "cli-read" },
        { token: "write-secret", scopes: ["uptime:write"], workspaceId: "ws_cli", actor: "cli-write" },
        { token: "probe-secret", scopes: ["uptime:probe"], workspaceId: "ws_cli", actor: "cli-probe" },
        { token: "report-secret", scopes: ["uptime:report"], workspaceId: "ws_cli", actor: "cli-report" },
      ],
    });
    directOrigin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("denied", { status: 403 }),
    });
    const edgeUrl = `http://${runtime.server.hostname}:${runtime.server.port}`;
    const directOriginUrl = `http://${directOrigin.hostname}:${directOrigin.port}`;
    const smoke = await runCliAsync([
      "cloud",
      "edge-smoke",
      "--url",
      edgeUrl,
      "--workspace-id",
      "ws_cli",
      "--mutation",
      "--direct-origin-url",
      directOriginUrl,
      "--smoke-id",
      "cli-test",
      "--json",
    ], dbPath, {
      HASNA_UPTIME_EDGE_READ_TOKEN: "read-secret",
      HASNA_UPTIME_EDGE_WRITE_TOKEN: "write-secret",
      HASNA_UPTIME_EDGE_PROBE_TOKEN: "probe-secret",
      HASNA_UPTIME_EDGE_REPORT_TOKEN: "report-secret",
    });
    const stdout = new TextDecoder().decode(smoke.stdout);
    const stderr = new TextDecoder().decode(smoke.stderr);
    const report = JSON.parse(stdout);

    expect(smoke.exitCode).toBe(1);
    expect(report).toMatchObject({
      kind: "open-uptime.edge-smoke",
      status: "failed",
      promotionReady: false,
      workspaceId: "ws_cli",
      mutationRequested: true,
      smokeId: "cli-test",
    });
    expect(Object.fromEntries(report.checks.map((check: { name: string; ok: boolean }) => [check.name, check.ok]))).toMatchObject({
      health: true,
      readiness: false,
      "unauth-dashboard-denied": true,
      "unauth-ready-denied": true,
      "unauth-summary-denied": true,
      "unauth-monitors-denied": true,
      "authenticated-dashboard-fail-closed": true,
      "read-token-allowed": true,
      "wrong-workspace-denied": true,
      "wrong-workspace-mutation-denied": true,
      "wrong-scope-mutation-denied": true,
      "denied-origin-mutation": true,
      "report-delivery-fail-closed": true,
      "probe-api-fail-closed": true,
      "import-apply-fail-closed": true,
      "inline-check-fail-closed": true,
      "write-mutation-roundtrip": true,
      "direct-origin-denied": true,
    });
    expect(report.checks.find((check: { name: string }) => check.name === "readiness").promotionOk).toBe(false);
    expect(stdout).not.toContain("read-secret");
    expect(stdout).not.toContain("write-secret");
    expect(stdout).not.toContain("probe-secret");
    expect(stdout).not.toContain("report-secret");
    expect(stderr).not.toContain("read-secret");
    expect(stderr).not.toContain("write-secret");
    expect(stderr).not.toContain("probe-secret");
    expect(stderr).not.toContain("report-secret");
    expect(runtime.service.listMonitors({ workspaceId: "ws_cli" })).toHaveLength(0);
  } finally {
    runtime?.server.stop(true);
    runtime?.service.close();
    directOrigin?.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud edge-smoke distinguishes passing partial checks from promotion readiness", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  let runtime: ReturnType<typeof serveUptime> | undefined;
  try {
    const dbPath = join(dir, "uptime.db");
    runtime = serveUptime({
      mode: "hosted",
      hostedSqliteDbPath: dbPath,
      allowHostedLocalStore: true,
      port: 0,
      hostedTokens: [
        { token: "read-secret", scopes: ["uptime:read"], workspaceId: "ws_cli", actor: "cli-read" },
        { token: "write-secret", scopes: ["uptime:write"], workspaceId: "ws_cli", actor: "cli-write" },
        { token: "probe-secret", scopes: ["uptime:probe"], workspaceId: "ws_cli", actor: "cli-probe" },
        { token: "report-secret", scopes: ["uptime:report"], workspaceId: "ws_cli", actor: "cli-report" },
      ],
    });
    const edgeUrl = `http://${runtime.server.hostname}:${runtime.server.port}`;
    const partial = await runCliAsync([
      "cloud",
      "edge-smoke",
      "--url",
      edgeUrl,
      "--workspace-id",
      "ws_cli",
      "--json",
    ], dbPath, {
      HASNA_UPTIME_EDGE_READ_TOKEN: "read-secret",
      HASNA_UPTIME_EDGE_WRITE_TOKEN: "write-secret",
      HASNA_UPTIME_EDGE_PROBE_TOKEN: "probe-secret",
      HASNA_UPTIME_EDGE_REPORT_TOKEN: "report-secret",
    });
    const strict = await runCliAsync([
      "cloud",
      "edge-smoke",
      "--url",
      edgeUrl,
      "--workspace-id",
      "ws_cli",
      "--require-promotion-ready",
      "--json",
    ], dbPath, {
      HASNA_UPTIME_EDGE_READ_TOKEN: "read-secret",
      HASNA_UPTIME_EDGE_WRITE_TOKEN: "write-secret",
      HASNA_UPTIME_EDGE_PROBE_TOKEN: "probe-secret",
      HASNA_UPTIME_EDGE_REPORT_TOKEN: "report-secret",
    });
    const report = JSON.parse(new TextDecoder().decode(partial.stdout));

    expect(partial.exitCode).toBe(1);
    expect(report.status).toBe("failed");
    expect(report.promotionReady).toBe(false);
    expect(report.checks.filter((check: { skipped?: boolean }) => check.skipped).map((check: { name: string }) => check.name)).toEqual([
      "write-mutation-roundtrip",
      "direct-origin-denied",
    ]);
    expect(strict.exitCode).toBe(1);
    expect(new TextDecoder().decode(strict.stdout)).not.toContain("read-secret");
  } finally {
    runtime?.server.stop(true);
    runtime?.service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud edge-smoke rejects successful direct-origin allowed statuses", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const result = runCli([
      "cloud",
      "edge-smoke",
      "--url",
      "https://edge.example",
      "--workspace-id",
      "ws_cli",
      "--direct-origin-url",
      "https://origin.example",
      "--direct-origin-allowed-status",
      "200",
      "--json",
    ], dbPath);
    const body = JSON.parse(new TextDecoder().decode(result.stdout));

    expect(result.exitCode).toBe(1);
    expect(body.error).toContain("4xx/5xx");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud edge-smoke requires explicit opt-in for unreachable direct origins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  let runtime: ReturnType<typeof serveUptime> | undefined;
  try {
    const dbPath = join(dir, "uptime.db");
    runtime = serveUptime({
      mode: "hosted",
      hostedSqliteDbPath: dbPath,
      allowHostedLocalStore: true,
      port: 0,
      hostedTokens: [
        { token: "read-secret", scopes: ["uptime:read"], workspaceId: "ws_cli", actor: "cli-read" },
        { token: "write-secret", scopes: ["uptime:write"], workspaceId: "ws_cli", actor: "cli-write" },
        { token: "probe-secret", scopes: ["uptime:probe"], workspaceId: "ws_cli", actor: "cli-probe" },
        { token: "report-secret", scopes: ["uptime:report"], workspaceId: "ws_cli", actor: "cli-report" },
      ],
    });
    const edgeUrl = `http://${runtime.server.hostname}:${runtime.server.port}`;
    const directOriginUrl = "http://127.0.0.1:1";
    const commonArgs = [
      "cloud",
      "edge-smoke",
      "--url",
      edgeUrl,
      "--workspace-id",
      "ws_cli",
      "--direct-origin-url",
      directOriginUrl,
      "--timeout-ms",
      "100",
      "--json",
    ];
    const env = {
      HASNA_UPTIME_EDGE_READ_TOKEN: "read-secret",
      HASNA_UPTIME_EDGE_WRITE_TOKEN: "write-secret",
      HASNA_UPTIME_EDGE_PROBE_TOKEN: "probe-secret",
      HASNA_UPTIME_EDGE_REPORT_TOKEN: "report-secret",
    };
    const blocked = await runCliAsync(commonArgs, dbPath, env);
    const allowed = await runCliAsync([
      ...commonArgs.slice(0, -1),
      "--allow-direct-origin-unreachable",
      "--json",
    ], dbPath, env);
    const blockedReport = JSON.parse(new TextDecoder().decode(blocked.stdout));
    const allowedReport = JSON.parse(new TextDecoder().decode(allowed.stdout));

    expect(blocked.exitCode).toBe(1);
    expect(blockedReport.checks.find((check: { name: string }) => check.name === "direct-origin-denied").ok).toBe(false);
    expect(allowed.exitCode).toBe(1);
    expect(allowedReport.directOriginUnreachableAllowed).toBe(true);
    expect(allowedReport.checks.find((check: { name: string }) => check.name === "direct-origin-denied").ok).toBe(true);
  } finally {
    runtime?.server.stop(true);
    runtime?.service.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI cloud edge-smoke rejects credentialed or path-bearing evidence URLs", () => {
  const dir = mkdtempSync(join(tmpdir(), "open-uptime-cli-"));
  try {
    const dbPath = join(dir, "uptime.db");
    const withUserinfo = runCli([
      "cloud",
      "edge-smoke",
      "--url",
      "https://user:pass@edge.example",
      "--workspace-id",
      "ws_cli",
      "--json",
    ], dbPath);
    const withPath = runCli([
      "cloud",
      "edge-smoke",
      "--url",
      "https://edge.example/private-token-path?api_key=secret",
      "--workspace-id",
      "ws_cli",
      "--json",
    ], dbPath);

    expect(withUserinfo.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(withUserinfo.stdout)).error).toContain("must not include username or password");
    expect(new TextDecoder().decode(withUserinfo.stdout)).not.toContain("user:pass");
    expect(withPath.exitCode).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(withPath.stdout)).error).toContain("without a path");
    expect(new TextDecoder().decode(withPath.stdout)).not.toContain("api_key");
    expect(new TextDecoder().decode(withPath.stdout)).not.toContain("secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edge-smoke negative mutation probes use a high-entropy non-colliding target", async () => {
  const deletePaths: string[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const authorized = headers.has("authorization");

    if (method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "uptime" });
    }
    if (method === "GET" && url.pathname === "/ready") {
      return authorized
        ? Response.json({ ok: true, productionReady: true })
        : Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (method === "GET" && url.pathname === "/") {
      return authorized
        ? Response.json({ error: "hosted dashboard disabled" }, { status: 501 })
        : Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (method === "GET" && url.pathname === "/api/v1/summary") {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (method === "GET" && url.pathname === "/api/v1/monitors") {
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
      if (url.searchParams.get("workspaceId") !== "ws_cli") return Response.json({ error: "forbidden" }, { status: 403 });
      return Response.json([]);
    }
    if (method === "DELETE" && url.pathname.startsWith("/api/v1/monitors/")) {
      deletePaths.push(url.pathname);
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (url.pathname === "/api/v1/report" || url.pathname === "/api/v1/probes" || url.pathname === "/api/v1/imports/apply" || url.pathname === "/api/v1/check-all") {
      return Response.json({ error: "not implemented" }, { status: 501 });
    }
    return Response.json({ error: "unexpected test request", path: url.pathname, method }, { status: 500 });
  }) as typeof fetch;

  const report = await runEdgeSmoke({
    url: "https://edge.example",
    workspaceId: "ws_cli",
    readToken: "read-secret",
    writeToken: "write-secret",
    probeToken: "probe-secret",
    reportToken: "report-secret",
    fetchImpl,
  });

  expect(report.status).toBe("passed");
  expect(report.promotionReady).toBe(false);
  expect(deletePaths).toHaveLength(3);
  expect(new Set(deletePaths)).toHaveLength(1);
  expect(deletePaths[0]?.startsWith("/api/v1/monitors/edge-smoke-negative-")).toBe(true);
  expect(deletePaths[0]).not.toContain("edge-smoke-nonexistent");
  expect(Object.fromEntries(report.checks.map((check) => [check.name, check.ok]))).toMatchObject({
    "wrong-workspace-mutation-denied": true,
    "wrong-scope-mutation-denied": true,
    "denied-origin-mutation": true,
  });
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
    const createProbe = runCli([
      "probes",
      "create",
      "private-probe-01",
      "--private-key-file",
      keyPath,
      "--probe-class",
      "private",
      "--probe-location",
      "spark01",
      "--machine-id",
      "machine002",
      "--json",
    ], dbPath);
    const probe = JSON.parse(new TextDecoder().decode(createProbe.stdout));
    const createJob = runCli([
      "probes",
      "jobs",
      "create",
      "--monitor",
      monitor.id,
      "--schedule-slot",
      "cli-slot-1",
      "--probe-class",
      "private",
      "--probe-locations",
      "spark01",
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
    expect(probe.probeClass).toBe("private");
    expect(probe.probeLocation).toBe("spark01");
    expect(probe.machineId).toBe("machine002");
    expect(createJob.exitCode).toBe(0);
    expect(job.probePolicy).toEqual({ probeClass: "private", locations: ["spark01"] });
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

    const failed = runCli(["probes", "create", "private-probe-01", "--private-key-file", existingKeyPath, "--json"], dbPath);
    const listAfterFailure = runCli(["probes", "list", "--all", "--json"], dbPath);
    const retry = runCli(["probes", "create", "private-probe-01", "--private-key-file", retryKeyPath, "--json"], dbPath);
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
    const createProbe = runCli(["probes", "create", "private-probe-01", "--private-key-file", keyPath, "--json"], dbPath);
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
