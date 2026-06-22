// ─── Kernel commands and shared CLI options ─────────────────────────────────

import type { Command } from "commander";
import chalk from "chalk";
import type { SessionOptions } from "../../types/index.js";
import { createSession, resolveKernelRemoteSessionId } from "../../lib/session.js";
import {
  captureKernelComputerScreenshotToDownloads,
  deleteKernelBrowser,
  downloadKernelFileToDownloads,
  downloadKernelReplayToDownloads,
  executeKernelPlaywright,
  getKernelFileInfo,
  getKernelStatus,
  listKernelBrowsers,
  listKernelFiles,
  listKernelReplays,
  retrieveKernelBrowser,
  runKernelComputerAction,
  startKernelReplay,
  stopKernelReplay,
} from "../../engines/kernel.js";

type PairMap = Record<string, string>;

export interface KernelCliOptions {
  kernelPersistenceId?: string;
  kernelProfileId?: string;
  kernelProfileName?: string;
  kernelSaveProfileChanges?: boolean;
  kernelTimeoutSeconds?: string;
  kernelProjectId?: string;
  kernelBaseUrl?: string;
  kernelRequestTimeoutMs?: string;
  kernelProxyId?: string;
  kernelGpu?: boolean;
  kernelKioskMode?: boolean;
  kernelTag?: string[];
  kernelEnv?: string[];
  kernelEnvSecret?: string[];
  kernelAuthMode?: string;
  kernelTelemetry?: string;
  kernelChromePolicy?: string;
}

function collect(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function parsePairs(values?: string[], label = "value"): PairMap | undefined {
  if (!values?.length) return undefined;
  const out: PairMap = {};
  for (const entry of values) {
    const index = entry.indexOf("=");
    if (index <= 0) throw new Error(`${label} must use KEY=VALUE: ${entry}`);
    out[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return out;
}

function parseJson(value: string | undefined, label: string): Record<string, unknown> | boolean | undefined {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be JSON object, true, or false`);
  }
}

function parseNumber(value: string | undefined, label: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function addKernelOptions(command: Command): Command {
  return command
    .option("--kernel-persistence-id <name>", "Kernel reusable profile/persistence name")
    .option("--kernel-profile-id <id>", "Kernel profile id")
    .option("--kernel-profile-name <name>", "Kernel profile name")
    .option("--no-kernel-save-profile-changes", "Do not persist profile changes when Kernel browser is deleted")
    .option("--kernel-timeout-seconds <seconds>", "Kernel browser inactivity timeout")
    .option("--kernel-project-id <id>", "Kernel project id")
    .option("--kernel-base-url <url>", "Custom Kernel API base URL")
    .option("--kernel-request-timeout-ms <ms>", "Kernel SDK request timeout")
    .option("--kernel-proxy-id <id>", "Kernel proxy id")
    .option("--kernel-gpu", "Enable Kernel GPU browser session")
    .option("--kernel-kiosk-mode", "Hide address bar and tabs in Kernel live view")
    .option("--kernel-tag <key=value>", "Kernel session tag; repeatable", collect, [])
    .option("--kernel-env <key=value>", "Kernel non-secret env var; repeatable", collect, [])
    .option("--kernel-env-secret <env=secret-key>", "Kernel env var from @hasna/secrets; repeatable", collect, [])
    .option("--kernel-auth-mode <mode>", "Kernel auth mode: managed|cdp_autofill|auto|off")
    .option("--kernel-telemetry <json|boolean>", "Kernel telemetry config")
    .option("--kernel-chrome-policy <json>", "Kernel Chrome enterprise policy JSON object");
}

export function kernelSessionOptionsFromCli(opts: KernelCliOptions): Partial<SessionOptions> {
  return {
    kernelPersistenceId: opts.kernelPersistenceId,
    kernelProfileId: opts.kernelProfileId,
    kernelProfileName: opts.kernelProfileName,
    kernelSaveProfileChanges: opts.kernelSaveProfileChanges,
    kernelTimeoutSeconds: parseNumber(opts.kernelTimeoutSeconds, "--kernel-timeout-seconds"),
    kernelProjectId: opts.kernelProjectId,
    kernelBaseUrl: opts.kernelBaseUrl,
    kernelRequestTimeoutMs: parseNumber(opts.kernelRequestTimeoutMs, "--kernel-request-timeout-ms"),
    kernelProxyId: opts.kernelProxyId,
    kernelGpu: opts.kernelGpu,
    kernelKioskMode: opts.kernelKioskMode,
    kernelTags: parsePairs(opts.kernelTag, "--kernel-tag"),
    kernelEnv: parsePairs(opts.kernelEnv, "--kernel-env"),
    kernelEnvSecrets: parsePairs(opts.kernelEnvSecret, "--kernel-env-secret"),
    kernelAuthMode: opts.kernelAuthMode as SessionOptions["kernelAuthMode"],
    kernelTelemetry: parseJson(opts.kernelTelemetry, "--kernel-telemetry"),
    kernelChromePolicy: parseJson(opts.kernelChromePolicy, "--kernel-chrome-policy") as Record<string, unknown> | undefined,
  };
}

function remoteId(value: string): string {
  return resolveKernelRemoteSessionId(value);
}

function printJsonOrText(value: unknown, json: boolean | undefined, text: () => void): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else text();
}

export function register(program: Command) {
  const kernel = program.command("kernel").description("Manage Kernel cloud browser sessions and artifacts");

  kernel
    .command("status")
    .description("Show Kernel SDK/auth/config status")
    .option("--remote", "Verify remote Kernel API access by listing active sessions")
    .option("--json", "Output as JSON")
    .action(async (opts: { remote?: boolean; json?: boolean }) => {
      const status = await getKernelStatus({ checkRemote: opts.remote });
      printJsonOrText(status, opts.json, () => {
        console.log(`Kernel SDK: ${status.available ? "available" : "missing"}${status.sdkVersion ? ` (${status.sdkVersion})` : ""}`);
        console.log(`Configured: ${status.configured ? chalk.green(status.apiKeySource) : chalk.yellow("missing")}`);
        if (status.remote) console.log(`Remote: ${status.remote.ok ? chalk.green("ok") : chalk.red(status.remote.error ?? "failed")}`);
        if (!status.configured) console.log(chalk.gray(`Store key: ${status.setup.vault}`));
      });
    });

  kernel
    .command("sessions")
    .description("List Kernel browser sessions")
    .option("--status <status>", "Kernel status filter", "active")
    .option("--limit <n>", "Maximum sessions", "25")
    .option("--json", "Output as JSON")
    .action(async (opts: { status?: string; limit: string; json?: boolean }) => {
      const sessions = await listKernelBrowsers({ status: opts.status, limit: parseNumber(opts.limit, "--limit") });
      printJsonOrText({ sessions }, opts.json, () => {
        if (sessions.length === 0) console.log(chalk.gray("No Kernel sessions found"));
        for (const session of sessions) console.log(`${session.session_id} ${session.status ?? ""} ${session.name ?? ""}`);
      });
    });

  kernel
    .command("get <session>")
    .description("Get Kernel browser session details")
    .option("--json", "Output as JSON")
    .action(async (session: string, opts: { json?: boolean }) => {
      const result = await retrieveKernelBrowser(remoteId(session));
      printJsonOrText(result, opts.json, () => console.log(JSON.stringify(result, null, 2)));
    });

  kernel
    .command("close <session>")
    .description("Delete a Kernel browser session")
    .action(async (session: string) => {
      const result = await deleteKernelBrowser(remoteId(session));
      console.log(chalk.green(`✓ Deleted Kernel session: ${result.deleted}`));
    });

  const files = kernel.command("files").description("Inspect and download files from active Kernel browser sessions");
  files
    .command("list <session>")
    .option("--path <path>", "Remote path", "/")
    .option("--json", "Output as JSON")
    .action(async (session: string, opts: { path: string; json?: boolean }) => {
      const result = { path: opts.path, files: await listKernelFiles(remoteId(session), opts.path) };
      printJsonOrText(result, opts.json, () => {
        for (const file of result.files) console.log(`${file.is_dir ? "dir " : "file"} ${file.size_bytes.toString().padStart(8)} ${file.path}`);
      });
    });

  files
    .command("info <session> <path>")
    .option("--json", "Output as JSON")
    .action(async (session: string, path: string, opts: { json?: boolean }) => {
      const file = await getKernelFileInfo(remoteId(session), path);
      printJsonOrText({ file }, opts.json, () => console.log(`${file.path} ${file.size_bytes} bytes`));
    });

  files
    .command("download <session> <path>")
    .option("--filename <name>", "Local download filename")
    .option("--json", "Output as JSON")
    .action(async (session: string, path: string, opts: { filename?: string; json?: boolean }) => {
      const download = await downloadKernelFileToDownloads(remoteId(session), path, { filename: opts.filename });
      printJsonOrText({ download }, opts.json, () => console.log(chalk.green(`✓ Downloaded: ${download.path}`)));
    });

  kernel
    .command("exec <session> <code>")
    .description("Execute Playwright/TypeScript code inside a Kernel browser VM")
    .option("--timeout-sec <seconds>", "Execution timeout")
    .option("--json", "Output as JSON")
    .action(async (session: string, code: string, opts: { timeoutSec?: string; json?: boolean }) => {
      const result = await executeKernelPlaywright(remoteId(session), code, { timeoutSec: parseNumber(opts.timeoutSec, "--timeout-sec") });
      printJsonOrText(result, opts.json, () => console.log(JSON.stringify(result.result ?? result, null, 2)));
    });

  const computer = kernel.command("computer").description("Run Kernel computer-control actions");
  computer
    .command("screenshot <session>")
    .option("--filename <name>", "Local download filename")
    .option("--json", "Output as JSON")
    .action(async (session: string, opts: { filename?: string; json?: boolean }) => {
      const download = await captureKernelComputerScreenshotToDownloads(remoteId(session), { filename: opts.filename });
      printJsonOrText({ download }, opts.json, () => console.log(chalk.green(`✓ Screenshot saved: ${download.path}`)));
    });

  computer
    .command("action <session> <action> <json>")
    .description("Run click|move|type|press|scroll|batch with JSON params")
    .option("--json-output", "Output as JSON")
    .action(async (session: string, action: "click" | "move" | "type" | "press" | "scroll" | "batch", paramsJson: string, opts: { jsonOutput?: boolean }) => {
      const params = JSON.parse(paramsJson) as Record<string, unknown>;
      const result = await runKernelComputerAction(remoteId(session), action, params);
      printJsonOrText(result, opts.jsonOutput, () => console.log(chalk.green("✓ Action completed")));
    });

  const replays = kernel.command("replays").description("Manage Kernel replay recordings");
  replays
    .command("list <session>")
    .option("--json", "Output as JSON")
    .action(async (session: string, opts: { json?: boolean }) => {
      const result = { replays: await listKernelReplays(remoteId(session)) };
      printJsonOrText(result, opts.json, () => {
        if (result.replays.length === 0) console.log(chalk.gray("No replays found"));
        for (const replay of result.replays) console.log(`${replay.replay_id} ${replay.replay_view_url ?? ""}`);
      });
    });

  replays
    .command("start <session>")
    .option("--framerate <fps>", "Recording framerate")
    .option("--max-duration-seconds <seconds>", "Maximum duration")
    .option("--record-audio", "Record audio")
    .option("--json", "Output as JSON")
    .action(async (session: string, opts: { framerate?: string; maxDurationSeconds?: string; recordAudio?: boolean; json?: boolean }) => {
      const replay = await startKernelReplay(remoteId(session), {
        framerate: parseNumber(opts.framerate, "--framerate"),
        maxDurationSeconds: parseNumber(opts.maxDurationSeconds, "--max-duration-seconds"),
        recordAudio: opts.recordAudio,
      });
      printJsonOrText({ replay }, opts.json, () => console.log(chalk.green(`✓ Replay started: ${replay.replay_id}`)));
    });

  replays
    .command("stop <session> <replay>")
    .action(async (session: string, replay: string) => {
      await stopKernelReplay(remoteId(session), replay);
      console.log(chalk.green(`✓ Replay stopped: ${replay}`));
    });

  replays
    .command("download <session> <replay>")
    .option("--filename <name>", "Local download filename")
    .option("--json", "Output as JSON")
    .action(async (session: string, replay: string, opts: { filename?: string; json?: boolean }) => {
      const download = await downloadKernelReplayToDownloads(remoteId(session), replay, { filename: opts.filename });
      printJsonOrText({ download }, opts.json, () => console.log(chalk.green(`✓ Replay downloaded: ${download.path}`)));
    });

  addKernelOptions(kernel
    .command("open")
    .description("Create a Kernel browser session through open-browser and return local plus remote ids")
    .option("--url <url>", "Start URL")
    .option("--headed", "Run headful for live view/computer controls")
    .option("--json", "Output as JSON"))
    .action(async (opts: KernelCliOptions & { url?: string; headed?: boolean; json?: boolean }) => {
      const { session } = await createSession({
        engine: "kernel",
        startUrl: opts.url,
        headless: !opts.headed,
        ...kernelSessionOptionsFromCli(opts),
      });
      printJsonOrText({ session }, opts.json, () => {
        console.log(chalk.green(`✓ Session created: ${session.id}`));
        console.log(chalk.gray(`  Kernel: ${session.remote_session_id ?? "unknown"}`));
        if (session.browser_live_view_url) console.log(chalk.gray(`  Live view: ${session.browser_live_view_url}`));
      });
    });
}
