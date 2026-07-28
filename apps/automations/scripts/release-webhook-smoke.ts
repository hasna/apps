#!/usr/bin/env bun
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const ROUTE_ID = "release-smoke";
const ROUTE_PATH = "/webhooks/release-smoke";
const AUTOMATION_ID = "release.webhook-smoke";
const RUNNER_ID = "open-loops:release-smoke";
const SECRET_ENV_KEY = "HASNA_AUTOMATIONS_WEBHOOK_SECRET_RELEASE_SMOKE";
const DEFAULT_PEERS = ["@hasna/actions@^0.1.0"];
const RELEASE_0_1_1_PEERS = ["@hasna/actions@0.1.0"];

interface SmokeArgs {
  packageSpec: string;
  peers: string[];
  installDir?: string;
  dataDir?: string;
  keep: boolean;
  port: number;
  timeoutMs: number;
  skipInstall: boolean;
  binDir?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type CommandEnv = Record<string, string | undefined>;

interface Check {
  name: string;
  ok: true;
  [key: string]: unknown;
}

const checks: Check[] = [];

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const installDir = args.installDir ? resolve(args.installDir) : args.skipInstall ? "" : mkdtempSync(join(tmpdir(), "hasna-automations-install-"));
  const dataDir = args.dataDir ? resolve(args.dataDir) : mkdtempSync(join(tmpdir(), "hasna-automations-data-"));
  const ownsInstallDir = !args.installDir && !args.skipInstall;
  const ownsDataDir = !args.dataDir;
  const automationsBin = commandForBin("automations", args, installDir);
  const daemonBin = commandForBin("automations-daemon", args, installDir);
  const webhookSecret = randomUUID();

  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    if (!args.skipInstall) mkdirSync(installDir, { recursive: true, mode: 0o700 });
    if (!args.skipInstall) {
      await prepareInstallDir(installDir, args);
      checks.push({
        name: "temp_install",
        ok: true,
        packageSpec: args.packageSpec,
        peers: args.peers,
        installDir: args.keep ? installDir : "<temporary>",
      });
    } else {
      checks.push({
        name: "temp_install",
        ok: true,
        skipped: true,
        binDir: args.binDir ?? "<PATH>",
      });
    }

    const installedVersion = (await runCommand([automationsBin, "--version"], { timeoutMs: args.timeoutMs })).stdout.trim();
    assert(installedVersion.length > 0, "installed automations binary did not print a version");
    checks.push({ name: "installed_binaries", ok: true, automationsVersion: installedVersion });

    const specPath = join(dataDir, "release-webhook-smoke-automation.json");
    writeFileSync(specPath, `${JSON.stringify(releaseAutomationSpec(args.packageSpec), null, 2)}\n`, { mode: 0o600 });

    const createAutomation = await runJsonCommand([
      automationsBin,
      "--dir",
      dataDir,
      "--json",
      "create",
      specPath,
    ], { timeoutMs: args.timeoutMs });
    assert(createAutomation.id === AUTOMATION_ID, "automation create returned an unexpected id");
    checks.push({ name: "create_automation", ok: true, automationId: AUTOMATION_ID });

    const route = await runJsonCommand([
      automationsBin,
      "--dir",
      dataDir,
      "--json",
      "webhooks",
      "create",
      AUTOMATION_ID,
      "--id",
      ROUTE_ID,
      "--path",
      ROUTE_PATH,
      "--source",
      "open-automations.release-smoke",
      "--type",
      "webhook.delivery",
      "--data-path",
      "payload",
      "--dedupe-key-header",
      "X-Hasna-Event-Id",
      "--secret-ref",
      "secret://automations/webhooks/release-smoke",
    ], { timeoutMs: args.timeoutMs });
    assert(route.id === ROUTE_ID && route.path === ROUTE_PATH, "webhook route create returned unexpected route metadata");
    checks.push({
      name: "create_webhook_route",
      ok: true,
      routeId: ROUTE_ID,
      path: ROUTE_PATH,
      signed: Boolean(route.signature),
      secret: "<redacted>",
    });

    const heartbeat = await runJsonCommand([
      daemonBin,
      "--dir",
      dataDir,
      "--json",
      "run",
      "--once",
      "--interval-ms",
      "100",
      "--ttl-ms",
      "1000",
    ], { timeoutMs: args.timeoutMs });
    assert(heartbeat.ok === true, "daemon run --once did not report ok");

    const status = await runJsonCommand([daemonBin, "--dir", dataDir, "--json", "status"], { timeoutMs: args.timeoutMs });
    assert(status.daemon?.active === true, "daemon status did not report an active lease after heartbeat");
    checks.push({ name: "daemon_health", ok: true, active: true, mode: status.daemon.metadata?.mode ?? "run" });

    const serve = Bun.spawn({
      cmd: [
        daemonBin,
        "--dir",
        dataDir,
        "--json",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(args.port),
        "--interval-ms",
        "100",
        "--ttl-ms",
        "1000",
      ],
      cwd: process.cwd(),
      env: { ...process.env, [SECRET_ENV_KEY]: webhookSecret },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      await waitForHealth(`http://127.0.0.1:${args.port}/healthz`, serve, args.timeoutMs);
      checks.push({ name: "daemon_serve_healthz", ok: true, url: `http://127.0.0.1:${args.port}/healthz` });

      const deliveryBody = JSON.stringify({
        payload: {
          repository: "open-automations",
          release: args.packageSpec,
          smoke: "delivery-smoke",
        },
      });
      const signedPost = await postSignedDelivery({
        url: `http://127.0.0.1:${args.port}${ROUTE_PATH}`,
        body: deliveryBody,
        dedupeKey: "delivery-smoke",
        secret: webhookSecret,
      });
      assert(signedPost.status === 202, `signed webhook POST returned HTTP ${signedPost.status}: ${JSON.stringify(signedPost.json)}`);
      assert(signedPost.json.ok === true && signedPost.json.dedupeKey === "delivery-smoke", "signed webhook POST returned unexpected response body");
      const materialized = signedPost.json.materialized;
      assert(Array.isArray(materialized) && materialized[0]?.actionIds?.length === 1, "signed webhook POST did not materialize one queued action");
      checks.push({
        name: "signed_webhook_post",
        ok: true,
        status: signedPost.status,
        routeId: signedPost.json.routeId,
        dedupeKey: signedPost.json.dedupeKey,
        materializedActions: materialized[0].actionIds.length,
        secret: "<redacted>",
      });
    } finally {
      await stopChild(serve);
    }

    const claim = await runJsonCommand([
      automationsBin,
      "--dir",
      dataDir,
      "--json",
      "queue",
      "claim",
      "--runner",
      RUNNER_ID,
    ], { timeoutMs: args.timeoutMs });
    assert(claim?.status === "claimed", "queue claim did not return a claimed action");
    assert(claim.claimedBy === RUNNER_ID, "queue claim returned an unexpected runner");
    checks.push({
      name: "queue_claim",
      ok: true,
      runner: RUNNER_ID,
      actionId: claim.id,
      actionKind: claim.actionId,
      status: claim.status,
    });

    const handoffBody = JSON.stringify({
      payload: {
        repository: "open-automations",
        release: args.packageSpec,
        smoke: "delivery-handoff",
      },
    });
    const handoffEvent = await runJsonCommand([
      automationsBin,
      "--dir",
      dataDir,
      "--json",
      "webhooks",
      "event",
      ROUTE_ID,
      "--body-json",
      handoffBody,
      "--header",
      "X-Hasna-Event-Id:delivery-handoff",
    ], { timeoutMs: args.timeoutMs });
    assert(handoffEvent.source === "open-automations.release-smoke", "handoff event had unexpected source");
    assert(handoffEvent.type === "webhook.delivery", "handoff event had unexpected type");
    assert(handoffEvent.dedupeKey === "delivery-handoff", "handoff event had unexpected dedupe key");
    assert(handoffEvent.metadata?.webhook?.routeId === ROUTE_ID, "handoff event missing webhook route metadata");
    checks.push({
      name: "openloops_event_handoff_dry_run",
      ok: true,
      dryRunOnly: true,
      eventSource: handoffEvent.source,
      eventType: handoffEvent.type,
      dedupeKey: handoffEvent.dedupeKey,
      routeId: handoffEvent.metadata.webhook.routeId,
      dataKeys: Object.keys(handoffEvent.data ?? {}),
      wouldRun: "automations --json webhooks event release-smoke --body-json <redacted> --header X-Hasna-Event-Id:delivery-handoff | loops --json events handle generic",
    });

    console.log(JSON.stringify({
      ok: true,
      packageSpec: args.packageSpec,
      dataDir: args.keep ? dataDir : "<temporary>",
      installDir: args.skipInstall ? "<not-used>" : args.keep ? installDir : "<temporary>",
      cleanup: args.keep ? "kept" : "removed",
      redacted: true,
      checks,
    }, null, 2));
  } finally {
    if (!args.keep) {
      if (ownsDataDir) rmSync(dataDir, { recursive: true, force: true });
      if (ownsInstallDir) rmSync(installDir, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv: string[]): SmokeArgs {
  const args: SmokeArgs = {
    packageSpec: `@hasna/automations@${packageVersion()}`,
    peers: [],
    keep: false,
    port: 30000 + Math.floor(Math.random() * 20000),
    timeoutMs: 30000,
    skipInstall: false,
  };
  let useDefaultPeers = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--package") {
      args.packageSpec = value();
    } else if (arg.startsWith("--package=")) {
      args.packageSpec = arg.slice("--package=".length);
    } else if (arg === "--peer") {
      args.peers.push(value());
    } else if (arg.startsWith("--peer=")) {
      args.peers.push(arg.slice("--peer=".length));
    } else if (arg === "--no-default-peers") {
      useDefaultPeers = false;
    } else if (arg === "--install-dir") {
      args.installDir = value();
    } else if (arg.startsWith("--install-dir=")) {
      args.installDir = arg.slice("--install-dir=".length);
    } else if (arg === "--data-dir") {
      args.dataDir = value();
    } else if (arg.startsWith("--data-dir=")) {
      args.dataDir = arg.slice("--data-dir=".length);
    } else if (arg === "--bin-dir") {
      args.binDir = value();
    } else if (arg.startsWith("--bin-dir=")) {
      args.binDir = arg.slice("--bin-dir=".length);
    } else if (arg === "--skip-install") {
      args.skipInstall = true;
    } else if (arg === "--keep") {
      args.keep = true;
    } else if (arg === "--port") {
      args.port = Number(value());
    } else if (arg.startsWith("--port=")) {
      args.port = Number(arg.slice("--port=".length));
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(value());
    } else if (arg.startsWith("--timeout-ms=")) {
      args.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }

  args.peers = useDefaultPeers ? [...defaultPeersFor(args.packageSpec), ...args.peers] : args.peers;
  if (!args.packageSpec) throw new Error("--package is required");
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    throw new Error("--port must be an integer from 1 to 65535");
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be at least 1000");
  }
  if (args.skipInstall && args.binDir && !existsSync(args.binDir)) {
    throw new Error(`--bin-dir does not exist: ${args.binDir}`);
  }
  return args;
}

function defaultPeersFor(packageSpec: string): string[] {
  if (packageSpec === "@hasna/automations@0.1.1") return RELEASE_0_1_1_PEERS;
  return DEFAULT_PEERS;
}

async function prepareInstallDir(installDir: string, args: SmokeArgs): Promise<void> {
  const tempDir = join(installDir, ".tmp");
  const cacheDir = join(installDir, ".bun-cache");
  mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(installDir, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
    dependencies: {},
  }, null, 2)}\n`, { mode: 0o600 });
  await runCommand(["bun", "add", args.packageSpec, ...args.peers], {
    cwd: installDir,
    env: {
      BUN_INSTALL_CACHE_DIR: cacheDir,
      BUN_TMPDIR: tempDir,
      TMPDIR: tempDir,
      TEMP: tempDir,
      TMP: tempDir,
      XDG_CACHE_HOME: cacheDir,
    },
    timeoutMs: args.timeoutMs,
  });
}

function commandForBin(name: string, args: SmokeArgs, installDir: string): string {
  if (args.binDir) return join(resolve(args.binDir), name);
  if (args.skipInstall) return name;
  return join(installDir, "node_modules", ".bin", name);
}

function releaseAutomationSpec(packageSpec: string): unknown {
  return {
    schemaVersion: "1.0",
    id: AUTOMATION_ID,
    name: "Release webhook smoke",
    version: "1.0.0",
    triggers: [{
      kind: "webhook",
      source: "open-automations.release-smoke",
      type: "webhook.delivery",
      filter: { repository: "open-automations" },
    }],
    actions: [{
      id: "record-handoff-evidence",
      actionId: "todos.create",
      input: {
        title: "OpenAutomations release webhook smoke handoff",
        source: "release-webhook-smoke",
        dryRunOnly: true,
      },
    }],
    audit: {
      evidenceRefs: [`installed-package:${packageSpec}`],
    },
    metadata: {
      smoke: "release-webhook",
      dryRunOnly: true,
    },
  };
}

async function runJsonCommand(cmd: string[], options: { cwd?: string; env?: CommandEnv; timeoutMs: number }): Promise<any> {
  const result = await runCommand(cmd, options);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`command did not return JSON: ${cmdForLog(cmd)}\nstdout=${truncate(result.stdout)}\nstderr=${truncate(result.stderr)}`);
  }
}

async function runCommand(cmd: string[], options: { cwd?: string; env?: CommandEnv; timeoutMs: number }): Promise<CommandResult> {
  const child = Bun.spawn({
    cmd,
    cwd: options.cwd ?? process.cwd(),
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = Bun.sleep(options.timeoutMs).then(() => "timeout" as const);
  const exit = await Promise.race([child.exited, timeout]);
  if (exit === "timeout") {
    child.kill("SIGTERM");
    await stopChild(child);
    throw new Error(`command timed out after ${options.timeoutMs}ms: ${cmdForLog(cmd)}`);
  }
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exit !== 0) {
    throw new Error(`command failed (${exit}): ${cmdForLog(cmd)}\nstdout=${truncate(stdout)}\nstderr=${truncate(stderr)}`);
  }
  return { stdout, stderr, exitCode: exit };
}

async function waitForHealth(url: string, child: Bun.Subprocess<"pipe", "pipe", "inherit">, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const childState = await Promise.race([
      child.exited.then((exitCode) => ({ kind: "exited" as const, exitCode })),
      Bun.sleep(100).then(() => ({ kind: "pending" as const })),
    ]);
    if (childState.kind === "exited") {
      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      throw new Error(`daemon serve exited before health check (${childState.exitCode})\nstdout=${truncate(stdout)}\nstderr=${truncate(stderr)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be binding the socket.
    }
  }
  throw new Error(`daemon serve health check timed out: ${url}`);
}

async function postSignedDelivery(input: { url: string; body: string; dedupeKey: string; secret: string }): Promise<{ status: number; json: any }> {
  const signature = createHmac("sha256", input.secret).update(input.body).digest("hex");
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hasna-signature": signature,
      "x-hasna-event-id": input.dedupeKey,
    },
    body: input.body,
  });
  const json = await response.json();
  return { status: response.status, json };
}

async function stopChild(child: Bun.Subprocess<"pipe", "pipe", "inherit">): Promise<void> {
  const alreadyExited = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(0).then(() => false),
  ]);
  if (alreadyExited) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(1000).then(() => false),
  ]);
  if (!stopped) {
    child.kill("SIGKILL");
    await child.exited;
  }
}

function packageVersion(): string {
  try {
    return JSON.parse(Bun.file("package.json").textSync()).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function truncate(value: string, limit = 2000): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...<truncated>`;
}

function cmdForLog(cmd: string[]): string {
  const redactNext = new Set(["--body-json", "--event-json", "--header", "--result-json"]);
  return cmd.map((part, index) => {
    if (redactNext.has(cmd[index - 1] ?? "")) return "<redacted>";
    for (const name of redactNext) {
      if (part.startsWith(`${name}=`)) return `${name}=<redacted>`;
    }
    return part.includes(" ") ? JSON.stringify(part) : part;
  }).join(" ");
}

function printHelp(): void {
  console.log(`Release webhook smoke for installed @hasna/automations packages.

Usage:
  bun run scripts/release-webhook-smoke.ts [options]

Options:
  --package <spec>       Package spec to install. Default: @hasna/automations@<package.json version>
  --peer <spec>          Additional peer package spec. Repeatable.
  --no-default-peers     Do not install default @hasna/actions peer specs.
  --install-dir <path>   Reuse an install directory instead of creating a temp directory.
  --data-dir <path>      Reuse an automations data directory instead of creating a temp directory.
  --bin-dir <path>       Directory containing automations and automations-daemon bins.
  --skip-install         Use bins from --bin-dir or PATH instead of installing a package spec.
  --port <number>        Local daemon serve port. Default: random high port.
  --timeout-ms <number>  Command timeout. Default: 30000.
  --keep                 Keep temp install/data directories for inspection.

Examples:
  bun run smoke:webhook-release -- --package @hasna/automations@0.1.1
  bun run smoke:webhook-release -- --package file:$PWD --no-default-peers --peer file:/path/to/open-actions

Notes:
  The @hasna/automations@0.1.1 replay uses the known compatible peer set
  @hasna/actions@0.1.0 unless --no-default-peers is passed.
`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message, redacted: true }, null, 2));
  process.exit(1);
}
