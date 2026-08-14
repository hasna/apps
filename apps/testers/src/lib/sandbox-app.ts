import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { posix as pathPosix } from "node:path";
import { resolveCredential } from "./secrets-resolver.js";
import { getTestersDir } from "./paths.js";

export type SandboxAppMode = "dev" | "prod";
export type SandboxAppSyncStrategy = "rsync" | "archive";
export type SandboxAppCleanupMode = "delete" | "stop";
export type SandboxAppCommandSetting = "auto" | "none" | string;

export interface SandboxAppPostgresOptions {
  enabled: boolean;
  database: string;
  user: string;
  password: string;
  port: number;
  grantCreatedRoles?: boolean;
}

export interface SandboxAppLaunchOptions {
  sourceDir: string;
  workingDir?: string;
  provider?: string;
  image?: string;
  name?: string;
  remoteDir?: string;
  mode?: SandboxAppMode;
  port?: number;
  protocol?: string;
  syncStrategy?: SandboxAppSyncStrategy;
  includeBuildOutput?: boolean;
  exclude?: string[];
  env?: Record<string, string>;
  envFiles?: string[];
  providerEnv?: Record<string, string>;
  providerEnvFiles?: string[];
  providerEnvBaseDir?: string;
  scanRequiredEnv?: boolean;
  generateMissingSecretEnv?: boolean;
  urlEnvNames?: string[];
  inferUrlEnv?: boolean;
  hostEnvNames?: string[];
  inferHostEnv?: boolean;
  setupCommands?: string[];
  dbCommands?: string[];
  installCommand?: SandboxAppCommandSetting;
  buildCommand?: SandboxAppCommandSetting;
  startCommand?: string;
  waitUrl?: string;
  waitTimeoutMs?: number;
  ttlSeconds?: number;
  minMemoryMb?: number;
  postgres?: SandboxAppPostgresOptions;
  keepOnFailure?: boolean;
  dryRun?: boolean;
  runtime?: SandboxAppRuntime;
  now?: () => Date;
}

export interface SandboxAppEnvParseOptions {
  allowLiteralSecretValues?: boolean;
}

export interface SandboxAppRuntime {
  createSandbox(input: {
    provider?: string;
    name?: string;
    image?: string;
    timeout?: number;
    config?: Record<string, unknown>;
  }): Promise<SandboxAppRuntimeSandbox>;
  uploadDir(
    sandboxId: string,
    localDir: string,
    remoteDir: string,
    opts?: { exclude?: string[]; syncStrategy?: SandboxAppSyncStrategy },
  ): Promise<{ bytes?: number } | undefined>;
  execCommand(
    sandboxId: string,
    command: string,
    opts?: {
      cwd?: string;
      env?: Record<string, string>;
      timeout?: number;
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    },
  ): Promise<{ session?: { id?: string }; result: SandboxAppExecResult }>;
  readFile?(
    sandboxId: string,
    path: string,
    opts?: { encoding?: "utf8"; offset?: number; limit?: number },
  ): Promise<string>;
  stopSandbox?(sandboxId: string): Promise<unknown>;
  deleteSandbox?(sandboxId: string): Promise<unknown>;
  getPublicUrl?(
    sandbox: SandboxAppRuntimeSandbox,
    port: number,
    protocol?: string,
  ): Promise<string>;
  keepAlive?(
    sandbox: SandboxAppRuntimeSandbox,
    durationMs: number,
  ): Promise<void>;
}

export interface SandboxAppRuntimeSandbox {
  id: string;
  provider: string;
  provider_sandbox_id?: string | null;
}

interface SandboxProviderAdapter {
  name: string;
  create(opts?: {
    image?: string;
    timeout?: number;
    envVars?: Record<string, string>;
    onTimeout?: "pause" | "terminate";
    autoResume?: boolean;
  }): Promise<{ id: string; status: string }>;
}

interface E2BSandboxClass {
  create(opts?: Record<string, unknown>): Promise<{ sandboxId: string }>;
  create(
    template: string,
    opts?: Record<string, unknown>,
  ): Promise<{ sandboxId: string }>;
  connect?(
    sandboxId: string,
    opts?: Record<string, unknown>,
  ): Promise<E2BSandboxInstance>;
  setTimeout?(
    sandboxId: string,
    durationMs: number,
    opts?: Record<string, unknown>,
  ): Promise<void>;
}

interface E2BSandboxInstance {
  setTimeout?(
    durationMs: number,
    opts?: Record<string, unknown>,
  ): Promise<void>;
  keepAlive?(durationMs: number): Promise<void>;
}

export interface SandboxAppProviderEnvOptions {
  providerEnv?: Record<string, string>;
  providerEnvFiles?: string[];
  providerEnvBaseDir?: string;
}

export interface SandboxAppExecResult {
  exit_code?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}

export interface SandboxAppLaunchPlan {
  sourceDir: string;
  workingDir: string;
  appLocalDir: string;
  remoteDir: string;
  appRemoteDir: string;
  stateRemoteDir: string;
  mode: SandboxAppMode;
  provider?: string;
  image?: string;
  name: string;
  port: number;
  protocol: string;
  internalUrl: string;
  publicHost: string;
  waitUrl: string;
  waitTimeoutMs: number;
  ttlSeconds: number;
  minMemoryMb?: number;
  syncStrategy: SandboxAppSyncStrategy;
  exclude: string[];
  envKeys: string[];
  scannedRequiredEnvKeys: string[];
  generatedEnvKeys: string[];
  urlEnvNames: string[];
  hostEnvNames: string[];
  phases: SandboxAppLaunchPhase[];
}

export interface SandboxAppLaunchPhase {
  name: string;
  command: string;
  cwd: string;
  timeoutMs?: number;
}

export interface SandboxAppLaunchResult extends SandboxAppLaunchPlan {
  sandboxId: string;
  provider: string;
  publicUrl: string;
  expiresAt: string;
  uploadBytes?: number;
  sessionIds: string[];
  dryRun?: boolean;
}

export interface SandboxAppLaunchRecord {
  sandboxId: string;
  provider: string;
  publicUrl: string;
  publicHost: string;
  internalUrl: string;
  sourceDir: string;
  workingDir: string;
  remoteDir: string;
  appRemoteDir: string;
  stateRemoteDir: string;
  mode: SandboxAppMode;
  port: number;
  createdAt: string;
  expiresAt: string;
}

export const SANDBOX_APP_DEFAULT_UPLOAD_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".next-*",
  ".turbo",
  ".cache",
  ".terraform",
  ".parcel-cache",
  ".vite",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vercel",
  "out",
  "build",
  "tmp",
  ".tmp",
  "logs",
  ".logs",
  ".env",
  ".env.*",
  ".npmrc",
  ".yarnrc",
  ".pnp.*",
  ".ssh",
  ".aws",
  ".gcloud",
  ".azure",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa",
  "id_ed25519",
  "coverage",
  "test-results",
  "playwright-report",
  ".venv",
  "__pycache__",
  ".DS_Store",
];

const DEFAULT_EXCLUDES = SANDBOX_APP_DEFAULT_UPLOAD_EXCLUDES;

export const SANDBOX_APP_BUILD_OUTPUT_EXCLUDES = new Set([
  "dist",
  ".next",
  ".next-*",
  ".turbo",
  ".parcel-cache",
  ".vite",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".vercel",
  "out",
  "build",
]);

const BUILD_OUTPUT_EXCLUDES = SANDBOX_APP_BUILD_OUTPUT_EXCLUDES;

const DEFAULT_URL_ENV_NAMES = [
  "APP_URL",
  "NEXT_PUBLIC_URL",
  "NEXT_PUBLIC_APP_URL",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "WEBAUTHN_ORIGIN",
];

const DEFAULT_HOST_ENV_NAMES = ["WEBAUTHN_RP_ID"];

const NEXT_DEV_HOST_ENV_NAMES = ["NEXT_ALLOWED_DEV_ORIGINS"];

const DEFAULT_WAIT_TIMEOUT_MS = 180_000;
const DEFAULT_PUBLIC_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_TTL_SECONDS = 60 * 60;
const MAX_CAPTURED_OUTPUT = 80_000;
const MAX_ENV_SCAN_FILES = 5_000;
const MAX_ENV_SCAN_FILE_BYTES = 512 * 1024;
const ENV_SCAN_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const ENV_SCAN_IGNORED_DIRS = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "playwright-report",
  "test",
  "tests",
  "test-results",
  "tmp",
  "__tests__",
]);
const PRIORITY_ENV_SCAN_FILES = [
  "env.ts",
  "env.js",
  "src/env.ts",
  "src/env.js",
  "src/lib/env.ts",
  "src/lib/env.js",
  "lib/env.ts",
  "lib/env.js",
  "lib/security/env.ts",
  "lib/security/env.js",
  "config/env.ts",
  "config/env.js",
];

export function parseDurationSeconds(
  value: string | undefined,
  fallback = DEFAULT_TTL_SECONDS,
): number {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const match = trimmed.match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number.parseInt(match[1]!, 10);
  const unit = (match[2] ?? "s").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error(`Invalid duration: ${value}`);
  if (unit === "ms") return Math.max(1, Math.ceil(amount / 1000));
  if (unit === "s") return amount;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 60 * 60;
  return amount * 24 * 60 * 60;
}

export function parseSandboxAppEnvAssignments(
  values: string[] | undefined,
  optionalValues: string[] | undefined = [],
  options: SandboxAppEnvParseOptions = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    const key = separator >= 0 ? trimmed.slice(0, separator).trim() : trimmed;
    assertEnvVarName(key, value);
    const envValue = separator >= 0 ? trimmed.slice(separator + 1) : `$${key}`;
    if (
      !options.allowLiteralSecretValues &&
      separator >= 0 &&
      isSecretLikeEnvKey(key) &&
      !isCredentialReference(envValue)
    ) {
      throw new Error(
        `Refusing literal value for secret-like env var ${key}. Use ${key}=$${key} or @secrets:<key>.`,
      );
    }
    env[key] = envValue;
  }
  for (const value of optionalValues ?? []) {
    const key = value.trim();
    if (!key) continue;
    assertEnvVarName(key, value);
    env[key] = `$?${key}`;
  }
  return env;
}

export async function launchSandboxApp(
  options: SandboxAppLaunchOptions,
): Promise<SandboxAppLaunchResult> {
  const now = options.now?.() ?? new Date();
  const sourceDir = resolve(options.sourceDir);
  const workingDir = normalizeRelativeWorkingDir(options.workingDir);
  const appLocalDir = resolve(sourceDir, workingDir);
  assertDirectory(sourceDir, "Sandbox app source directory");
  assertDirectory(appLocalDir, "Sandbox app working directory");

  const port = normalizePort(options.port ?? 3000);
  const mode = options.mode ?? "dev";
  const protocol = options.protocol ?? "http";
  const remoteDir = normalizeRemoteDir(
    options.remoteDir ?? defaultRemoteDir(options.provider, Date.now()),
  );
  const appRemoteDir = remoteJoin(remoteDir, workingDir);
  const stateRemoteDir = remoteJoin(remoteDir, ".testers-app");
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const publicUrlPlaceholder = `${protocol}://<sandbox-public-url>`;

  const planInput = {
    sourceDir,
    workingDir,
    appLocalDir,
    remoteDir,
    appRemoteDir,
    stateRemoteDir,
    mode,
    provider: options.provider,
    image: options.image,
    name:
      options.name ??
      `testers-app-${basename(sourceDir).replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
    port,
    protocol,
    publicUrl: publicUrlPlaceholder,
    waitTimeoutMs,
    ttlSeconds,
    minMemoryMb: options.minMemoryMb,
    syncStrategy: options.syncStrategy ?? "rsync",
    exclude: buildSandboxAppUploadExcludes(options),
  };
  const envBeforeServices = applyDeclaredDynamicEnv(
    resolveLaunchEnv(sourceDir, options.envFiles, options.env),
    publicUrlPlaceholder,
    options,
  );
  const envBeforeUrl = applyPostgresEnv(envBeforeServices, options.postgres);
  const scannedEnv = resolveRequiredLaunchEnv(
    sourceDir,
    appLocalDir,
    envBeforeUrl,
    options,
  );
  const launchEnv = scannedEnv.env;
  const providerEnv = resolveLaunchEnv(
    resolve(options.providerEnvBaseDir ?? sourceDir),
    options.providerEnvFiles,
    options.providerEnv,
  );
  const plan = buildLaunchPlan(planInput, launchEnv, options, scannedEnv);

  if (options.dryRun) {
    return {
      ...plan,
      sandboxId: "dry-run",
      provider: options.provider ?? "default",
      publicUrl: publicUrlPlaceholder,
      publicHost: plan.publicHost,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      sessionIds: [],
      dryRun: true,
    };
  }

  const runtime =
    options.runtime ??
    (await createDefaultSandboxAppRuntime({ ...launchEnv, ...providerEnv }));
  let sandbox: SandboxAppRuntimeSandbox | null = null;
  let publicUrl: string | null = null;
  const sessionIds: string[] = [];

  try {
    sandbox = await runtime.createSandbox({
      provider: options.provider,
      name: plan.name,
      image: options.image,
      timeout: ttlSeconds,
      config: {
        source: "testers",
        kind: "app-launch",
        mode,
        port,
        sourceDir,
        workingDir,
      },
    });

    if (options.minMemoryMb !== undefined) {
      await assertSandboxMemory(runtime, sandbox.id, options.minMemoryMb);
    }

    publicUrl = await resolvePublicUrl(runtime, sandbox, port, protocol);
    const livePlan = buildLaunchPlan(
      { ...planInput, publicUrl },
      launchEnv,
      options,
      scannedEnv,
    );
    const commandEnv = applyPublicEnv(
      launchEnv,
      publicUrl,
      livePlan.publicHost,
      livePlan.internalUrl,
      livePlan.urlEnvNames,
      livePlan.hostEnvNames,
    );
    const upload = await runtime.uploadDir(sandbox.id, sourceDir, remoteDir, {
      exclude: livePlan.exclude,
      syncStrategy: livePlan.syncStrategy,
    });

    for (const phase of livePlan.phases) {
      const output = await runPhase(runtime, sandbox.id, phase, commandEnv);
      if (output.sessionId) sessionIds.push(output.sessionId);
    }

    await runtime.keepAlive?.(sandbox, ttlSeconds * 1000);

    const result: SandboxAppLaunchResult = {
      ...livePlan,
      sandboxId: sandbox.id,
      provider: sandbox.provider,
      publicUrl,
      publicHost: livePlan.publicHost,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      uploadBytes: upload?.bytes,
      sessionIds,
    };
    saveSandboxAppLaunch(result, now);
    return result;
  } catch (error) {
    if (sandbox && !options.keepOnFailure) {
      await runtime.deleteSandbox?.(sandbox.id).catch(() => undefined);
    } else if (sandbox && options.keepOnFailure) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\nSandbox kept for debugging: ${sandbox.id}${publicUrl ? ` (${publicUrl})` : ""}`,
      );
    }
    throw error;
  }
}

export function buildSandboxAppUploadExcludes(
  options: Pick<SandboxAppLaunchOptions, "includeBuildOutput" | "exclude"> = {},
): string[] {
  const defaultExcludes = options.includeBuildOutput
    ? DEFAULT_EXCLUDES.filter((pattern) => !BUILD_OUTPUT_EXCLUDES.has(pattern))
    : DEFAULT_EXCLUDES;
  return options.exclude?.length
    ? [...defaultExcludes, ...options.exclude]
    : [...defaultExcludes];
}

async function assertSandboxMemory(
  runtime: SandboxAppRuntime,
  sandboxId: string,
  minMemoryMb: number,
): Promise<void> {
  const output = await runtime.execCommand(
    sandboxId,
    "awk '/^MemTotal:/ { printf \"%d\\n\", int($2 / 1024) }' /proc/meminfo",
    { timeout: 30 },
  );
  const exitCode = output.result.exit_code ?? output.result.exitCode ?? 0;
  const memoryMb = Number.parseInt(output.result.stdout?.trim() ?? "", 10);
  if (exitCode !== 0 || !Number.isFinite(memoryMb)) {
    throw new Error("Unable to verify sandbox memory for --min-memory-mb");
  }
  if (memoryMb < minMemoryMb) {
    throw new Error(
      `Sandbox memory check failed: requested at least ${minMemoryMb} MB, provider returned ${memoryMb} MB. Use a larger sandbox image/template or lower --min-memory-mb.`,
    );
  }
}

export async function stopSandboxAppLaunch(
  sandboxId: string,
  options: {
    cleanup?: SandboxAppCleanupMode;
    runtime?: SandboxAppRuntime;
  } & SandboxAppProviderEnvOptions = {},
): Promise<{
  sandboxId: string;
  cleanup: SandboxAppCleanupMode;
  record?: SandboxAppLaunchRecord;
}> {
  const runtime =
    options.runtime ??
    (await createDefaultSandboxAppRuntime(resolveProviderRuntimeEnv(options)));
  const record = findSandboxAppLaunch(sandboxId);
  const resolvedId = record?.sandboxId ?? sandboxId;
  const cleanup = options.cleanup ?? "delete";
  if (cleanup === "delete") {
    await runtime.deleteSandbox?.(resolvedId);
    removeSandboxAppLaunch(resolvedId);
  } else {
    await runtime.stopSandbox?.(resolvedId);
  }
  return { sandboxId: resolvedId, cleanup, ...(record ? { record } : {}) };
}

export async function readSandboxAppLogs(
  sandboxId: string,
  options: {
    lines?: number;
    runtime?: SandboxAppRuntime;
  } & SandboxAppProviderEnvOptions = {},
): Promise<{
  sandboxId: string;
  logs: string;
  record: SandboxAppLaunchRecord;
}> {
  const runtime =
    options.runtime ??
    (await createDefaultSandboxAppRuntime(resolveProviderRuntimeEnv(options)));
  if (!runtime.readFile)
    throw new Error("Sandbox runtime does not support reading files");
  const record = findSandboxAppLaunch(sandboxId);
  if (!record)
    throw new Error(`No testers sandbox launch record found for ${sandboxId}`);
  const logs = await runtime.readFile(
    record.sandboxId,
    remoteJoin(record.stateRemoteDir, "app.log"),
    { encoding: "utf8" },
  );
  const lines =
    options.lines === undefined
      ? logs
      : logs.split(/\r?\n/).slice(-options.lines).join("\n");
  return { sandboxId: record.sandboxId, logs: lines, record };
}

function resolveProviderRuntimeEnv(
  options: SandboxAppProviderEnvOptions,
): Record<string, string> {
  return resolveLaunchEnv(
    resolve(options.providerEnvBaseDir ?? process.cwd()),
    options.providerEnvFiles,
    options.providerEnv,
  );
}

export function listSandboxAppLaunches(): SandboxAppLaunchRecord[] {
  return readSandboxAppLaunches();
}

function buildLaunchPlan(
  input: {
    sourceDir: string;
    workingDir: string;
    appLocalDir: string;
    remoteDir: string;
    appRemoteDir: string;
    stateRemoteDir: string;
    mode: SandboxAppMode;
    provider?: string;
    image?: string;
    name: string;
    port: number;
    protocol: string;
    publicUrl: string;
    waitTimeoutMs: number;
    ttlSeconds: number;
    minMemoryMb?: number;
    syncStrategy: SandboxAppSyncStrategy;
    exclude: string[];
  },
  env: Record<string, string>,
  options: SandboxAppLaunchOptions,
  envScan: { scannedRequiredEnvKeys: string[]; generatedEnvKeys: string[] },
): SandboxAppLaunchPlan {
  const packageManager = detectPackageManager(
    input.sourceDir,
    input.appLocalDir,
  );
  const packageInfo = readPackageInfo(input.appLocalDir);
  const framework = detectFramework(packageInfo);
  const internalUrl = `http://127.0.0.1:${input.port}`;
  const publicHost = resolvePublicHost(input.publicUrl);
  const waitUrl = normalizeWaitUrl(options.waitUrl, internalUrl);
  const phases: SandboxAppLaunchPhase[] = [];
  const urlEnvNames = resolveUrlEnvNames(env, options);
  const hostEnvNames = resolveHostEnvNames(env, options, framework, input.mode);
  const commandEnv = applyPublicEnv(
    env,
    input.publicUrl,
    publicHost,
    internalUrl,
    urlEnvNames,
    hostEnvNames,
  );

  phases.push({
    name: "bootstrap",
    command: buildBootstrapCommand(packageManager, {
      needsBun: shouldBootstrapBun(packageManager, packageInfo, options),
    }),
    cwd: input.remoteDir,
  });

  if (options.postgres?.enabled) {
    phases.push({
      name: "postgres",
      command: buildPostgresSetupCommand(options.postgres),
      cwd: input.remoteDir,
      timeoutMs: 180_000,
    });
  }

  for (const [index, command] of (options.setupCommands ?? []).entries()) {
    phases.push({
      name: `setup:${index + 1}`,
      command,
      cwd: input.appRemoteDir,
    });
  }

  const install = resolveCommandSetting(
    options.installCommand ?? "auto",
    () => `${packageManager} install`,
  );
  if (install)
    phases.push({
      name: "install",
      command: install,
      cwd: input.remoteDir,
      timeoutMs: 900_000,
    });

  for (const [index, command] of (options.dbCommands ?? []).entries()) {
    phases.push({
      name: `db:${index + 1}`,
      command,
      cwd: input.appRemoteDir,
      timeoutMs: 600_000,
    });
    if (options.postgres?.enabled) {
      phases.push({
        name: `postgres:grants:${index + 1}`,
        command: buildPostgresGrantCommand(options.postgres),
        cwd: input.remoteDir,
        timeoutMs: 120_000,
      });
    }
  }

  const build = resolveCommandSetting(options.buildCommand ?? "auto", () =>
    input.mode === "prod" && packageInfo.scripts.build
      ? buildRunScriptCommand(packageManager, "build")
      : "",
  );
  if (build)
    phases.push({
      name: "build",
      command: build,
      cwd: input.appRemoteDir,
      timeoutMs: 1_200_000,
    });

  const start =
    options.startCommand ??
    inferStartCommand({
      packageManager,
      packageInfo,
      framework,
      mode: input.mode,
      port: input.port,
    });
  phases.push({
    name: "start",
    command: buildBackgroundStartCommand(start, input.stateRemoteDir),
    cwd: input.appRemoteDir,
  });
  phases.push({
    name: "wait",
    command: buildWaitForUrlCommand(
      waitUrl,
      input.waitTimeoutMs,
      input.stateRemoteDir,
    ),
    cwd: input.appRemoteDir,
    timeoutMs: input.waitTimeoutMs + 30_000,
  });
  const publicWaitTimeoutMs = Math.min(
    input.waitTimeoutMs,
    DEFAULT_PUBLIC_WAIT_TIMEOUT_MS,
  );
  phases.push({
    name: "public-wait",
    command: buildWaitForUrlCommand(
      normalizePublicWaitUrl(waitUrl, internalUrl, input.publicUrl),
      publicWaitTimeoutMs,
      input.stateRemoteDir,
      { stableChecks: 3, stableIntervalSeconds: 2 },
    ),
    cwd: input.appRemoteDir,
    timeoutMs: publicWaitTimeoutMs + 30_000,
  });

  return {
    sourceDir: input.sourceDir,
    workingDir: input.workingDir,
    appLocalDir: input.appLocalDir,
    remoteDir: input.remoteDir,
    appRemoteDir: input.appRemoteDir,
    stateRemoteDir: input.stateRemoteDir,
    mode: input.mode,
    provider: input.provider,
    image: input.image,
    name: input.name,
    port: input.port,
    protocol: input.protocol,
    internalUrl,
    publicHost,
    waitUrl,
    waitTimeoutMs: input.waitTimeoutMs,
    ttlSeconds: input.ttlSeconds,
    minMemoryMb: input.minMemoryMb,
    syncStrategy: input.syncStrategy,
    exclude: input.exclude,
    envKeys: Object.keys(commandEnv).sort(),
    scannedRequiredEnvKeys: envScan.scannedRequiredEnvKeys,
    generatedEnvKeys: envScan.generatedEnvKeys,
    urlEnvNames,
    hostEnvNames,
    phases,
  };
}

async function createDefaultSandboxAppRuntime(
  env: Record<string, string> = {},
): Promise<SandboxAppRuntime> {
  const mod = (await import("@hasna/sandboxes")) as unknown as {
    createSandboxesSDK: (options?: {
      providerApiKeys?: Record<string, string>;
      providerFactory?: (
        provider: string,
        apiKey?: string,
      ) => Promise<SandboxProviderAdapter>;
    }) => {
      createSandbox: SandboxAppRuntime["createSandbox"];
      uploadDir: SandboxAppRuntime["uploadDir"];
      execCommand: SandboxAppRuntime["execCommand"];
      readFile?: SandboxAppRuntime["readFile"];
      stopSandbox?: SandboxAppRuntime["stopSandbox"];
      deleteSandbox?: SandboxAppRuntime["deleteSandbox"];
    };
    getProvider?: (
      provider: string,
      apiKey?: string,
    ) => Promise<
      SandboxProviderAdapter & {
        getPublicUrl?: (
          providerSandboxId: string,
          port: number,
          protocol?: string,
        ) => Promise<string>;
        keepAlive?: (
          providerSandboxId: string,
          durationMs?: number,
        ) => Promise<void>;
      }
    >;
  };
  const providerApiKeys = Object.fromEntries(
    [
      ["e2b", env.E2B_API_KEY],
      ["daytona", env.DAYTONA_API_KEY],
      ["modal", env.MODAL_TOKEN_ID ?? env.MODAL_TOKEN_SECRET],
      ["kernel", env.KERNEL_API_KEY],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const sdk = mod.createSandboxesSDK({
    providerApiKeys,
    providerFactory: async (providerName: string, apiKey?: string) => {
      const provider = await mod.getProvider?.(providerName, apiKey);
      if (!provider)
        throw new Error(`Sandbox provider "${providerName}" is unavailable`);
      return providerName === "e2b"
        ? await wrapE2BProviderImageSupport(provider, apiKey)
        : provider;
    },
  });
  return {
    createSandbox: sdk.createSandbox.bind(sdk),
    uploadDir: sdk.uploadDir.bind(sdk),
    execCommand: sdk.execCommand.bind(sdk),
    readFile: sdk.readFile?.bind(sdk),
    stopSandbox: sdk.stopSandbox?.bind(sdk),
    deleteSandbox: sdk.deleteSandbox?.bind(sdk),
    getPublicUrl: async (sandbox, port, protocol) => {
      if (!sandbox.provider_sandbox_id)
        throw new Error(`Sandbox ${sandbox.id} has no provider sandbox ID`);
      const provider = await mod.getProvider?.(
        sandbox.provider,
        providerApiKeys[sandbox.provider],
      );
      if (!provider?.getPublicUrl)
        throw new Error(
          `Sandbox provider "${sandbox.provider}" does not support public URLs`,
        );
      return provider.getPublicUrl(sandbox.provider_sandbox_id, port, protocol);
    },
    keepAlive: async (sandbox, durationMs) => {
      if (!sandbox.provider_sandbox_id) return;
      if (sandbox.provider === "e2b") {
        await setE2BSandboxTimeout(
          sandbox.provider_sandbox_id,
          durationMs,
          providerApiKeys.e2b,
        );
        return;
      }
      const provider = await mod.getProvider?.(
        sandbox.provider,
        providerApiKeys[sandbox.provider],
      );
      await provider?.keepAlive?.(sandbox.provider_sandbox_id, durationMs);
    },
  };
}

async function setE2BSandboxTimeout(
  providerSandboxId: string,
  durationMs: number,
  apiKey?: string,
): Promise<void> {
  const mod = (await import("@e2b/code-interpreter")) as unknown as {
    Sandbox: E2BSandboxClass;
  };
  const opts = apiKey ? { apiKey } : undefined;
  if (mod.Sandbox.connect) {
    const sandbox = await mod.Sandbox.connect(providerSandboxId, opts);
    if (sandbox.setTimeout) {
      await sandbox.setTimeout(durationMs);
      return;
    }
    if (sandbox.keepAlive) {
      await sandbox.keepAlive(durationMs);
      return;
    }
  }
  if (mod.Sandbox.setTimeout) {
    await mod.Sandbox.setTimeout(providerSandboxId, durationMs, opts);
    return;
  }
  throw new Error(
    "Installed E2B SDK does not expose sandbox timeout extension",
  );
}

export async function wrapE2BProviderImageSupport(
  provider: SandboxProviderAdapter,
  apiKey?: string,
  sandboxClass?: E2BSandboxClass,
): Promise<SandboxProviderAdapter> {
  if (!sandboxClass) {
    const mod = (await import("@e2b/code-interpreter")) as unknown as {
      Sandbox: E2BSandboxClass;
    };
    sandboxClass = mod.Sandbox;
  }
  const createDefaultSandbox = provider.create.bind(provider);
  provider.create = async (opts) => {
    if (!opts?.image) return createDefaultSandbox(opts);
    const createOpts: Record<string, unknown> = {
      apiKey,
      timeoutMs: (opts.timeout ?? 3600) * 1000,
    };
    if (opts.envVars && Object.keys(opts.envVars).length > 0)
      createOpts.envs = opts.envVars;
    if (opts.onTimeout === "pause") {
      createOpts.lifecycle = {
        onTimeout: "pause",
        autoResume: opts.autoResume ?? true,
      };
    }
    const sandbox = await sandboxClass.create(opts.image, createOpts);
    return { id: sandbox.sandboxId, status: "running" };
  };
  return provider;
}

async function resolvePublicUrl(
  runtime: SandboxAppRuntime,
  sandbox: SandboxAppRuntimeSandbox,
  port: number,
  protocol: string,
): Promise<string> {
  if (!runtime.getPublicUrl) {
    throw new Error("Sandbox runtime does not support public URL exposure");
  }
  return runtime.getPublicUrl(sandbox, port, protocol);
}

async function runPhase(
  runtime: SandboxAppRuntime,
  sandboxId: string,
  phase: SandboxAppLaunchPhase,
  env: Record<string, string>,
): Promise<{ sessionId?: string }> {
  let stdout = "";
  let stderr = "";
  let result: Awaited<ReturnType<SandboxAppRuntime["execCommand"]>>;
  try {
    result = await runtime.execCommand(
      sandboxId,
      buildSandboxShellCommand(phase.command),
      {
        cwd: phase.cwd,
        env,
        timeout:
          phase.timeoutMs === undefined
            ? undefined
            : Math.ceil(phase.timeoutMs / 1000),
        onStdout: (data) => {
          stdout = appendCapturedOutput(stdout, data);
        },
        onStderr: (data) => {
          stderr = appendCapturedOutput(stderr, data);
        },
      },
    );
  } catch (error) {
    throw new Error(
      `Sandbox app phase "${phase.name}" failed: ${error instanceof Error ? error.message : String(error)}${formatCapturedOutput(stdout, stderr)}`,
    );
  }
  const exitCode = result.result.exit_code ?? result.result.exitCode ?? 0;
  if (exitCode !== 0) {
    throw new Error(
      `Sandbox app phase "${phase.name}" failed (${exitCode})${formatCapturedOutput(result.result.stdout ?? stdout, result.result.stderr ?? stderr)}`,
    );
  }
  return { sessionId: result.session?.id };
}

function buildSandboxShellCommand(command: string): string {
  return `bash -lc ${shellQuote(
    [
      'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"',
      'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$PATH"',
      command,
    ].join("\n"),
  )}`;
}

function resolveLaunchEnv(
  sourceDir: string,
  envFiles: string[] | undefined,
  env: Record<string, string> | undefined,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const file of envFiles ?? []) {
    Object.assign(resolved, parseEnvFile(resolve(sourceDir, file)));
  }
  for (const [key, value] of Object.entries(env ?? {})) {
    assertEnvVarName(key, key);
    if (value.startsWith("$?")) {
      const optionalName = value.slice(2).trim();
      if (optionalName && process.env[optionalName] !== undefined)
        resolved[key] = process.env[optionalName]!;
      continue;
    }
    const credential =
      value.startsWith("$") || value.startsWith("@secrets:")
        ? resolveCredential(value)
        : value;
    if (credential === null)
      throw new Error(`Missing sandbox app env value for ${key}`);
    resolved[key] = credential;
  }
  return resolved;
}

function resolveRequiredLaunchEnv(
  sourceDir: string,
  appLocalDir: string,
  env: Record<string, string>,
  options: SandboxAppLaunchOptions,
): {
  env: Record<string, string>;
  scannedRequiredEnvKeys: string[];
  generatedEnvKeys: string[];
} {
  if (!options.scanRequiredEnv) {
    return { env, scannedRequiredEnvKeys: [], generatedEnvKeys: [] };
  }

  const next = applyDeclaredDynamicEnv({ ...env }, "", options);
  const scannedRequiredEnvKeys = discoverRequiredEnvKeys(
    sourceDir,
    appLocalDir,
  );
  const generatedEnvKeys: string[] = [];
  const missingRequiredEnvKeys: string[] = [];

  for (const key of scannedRequiredEnvKeys) {
    if (next[key] !== undefined) continue;
    if (isImplicitUrlEnvKey(key, options)) {
      next[key] = "";
      continue;
    }
    if (isImplicitHostEnvKey(key, options)) {
      next[key] = "";
      continue;
    }
    if (
      options.generateMissingSecretEnv &&
      isGeneratableSandboxSecretEnvKey(key)
    ) {
      next[key] = generateSandboxSecret(key);
      generatedEnvKeys.push(key);
      continue;
    }
    missingRequiredEnvKeys.push(key);
  }

  if (missingRequiredEnvKeys.length > 0) {
    throw new Error(
      [
        "Missing required sandbox app env values discovered in source:",
        missingRequiredEnvKeys.join(", "),
        "Supply them with --env/--env-file, expose public origins with --url-env/--host-env, or use --generate-missing-secret-env for sandbox-only internal secrets.",
      ].join(" "),
    );
  }

  return {
    env: next,
    scannedRequiredEnvKeys,
    generatedEnvKeys: generatedEnvKeys.sort(),
  };
}

function applyDeclaredDynamicEnv(
  env: Record<string, string>,
  publicUrlPlaceholder: string,
  options: SandboxAppLaunchOptions,
): Record<string, string> {
  for (const name of options.urlEnvNames ?? []) {
    const key = name.trim();
    if (!key) continue;
    assertEnvVarName(key, name);
    env[key] ??= publicUrlPlaceholder;
  }
  for (const name of options.hostEnvNames ?? []) {
    const key = name.trim();
    if (!key) continue;
    assertEnvVarName(key, name);
    env[key] ??= resolvePublicHost(publicUrlPlaceholder);
  }
  return env;
}

export function discoverRequiredEnvKeys(
  sourceDir: string,
  appLocalDir: string = sourceDir,
): string[] {
  const keys = new Set<string>();
  const roots = [appLocalDir];
  if (appLocalDir !== sourceDir) roots.push(sourceDir);
  let scannedFiles = 0;

  for (const root of roots) {
    if (scannedFiles >= MAX_ENV_SCAN_FILES) break;
    scanPriorityEnvFiles(resolve(root));
    scanEnvRoot(resolve(root));
  }
  return [...keys].sort();

  function scanPriorityEnvFiles(root: string): void {
    for (const relativePath of PRIORITY_ENV_SCAN_FILES) {
      const fullPath = join(root, relativePath);
      if (!existsSync(fullPath)) continue;
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile() || stat.size > MAX_ENV_SCAN_FILE_BYTES) continue;
        collectRequiredEnvKeys(readFileSync(fullPath, "utf-8"), keys);
      } catch {
        continue;
      }
    }
  }

  function scanEnvRoot(dir: string): void {
    if (scannedFiles >= MAX_ENV_SCAN_FILES || !existsSync(dir)) return;
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of sortEnvScanEntries(entries)) {
      if (scannedFiles >= MAX_ENV_SCAN_FILES) return;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ENV_SCAN_IGNORED_DIRS.has(entry.name)) scanEnvRoot(fullPath);
        continue;
      }
      if (!entry.isFile() || !shouldScanEnvFile(entry.name)) continue;
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size > MAX_ENV_SCAN_FILE_BYTES) continue;
      scannedFiles += 1;
      collectRequiredEnvKeys(readFileSync(fullPath, "utf-8"), keys);
    }
  }
}

function sortEnvScanEntries(entries: Dirent<string>[]): Dirent<string>[] {
  return [...entries].sort((left, right) => {
    const priority = envScanEntryPriority(left) - envScanEntryPriority(right);
    if (priority !== 0) return priority;
    return left.name.localeCompare(right.name);
  });
}

function envScanEntryPriority(entry: Dirent<string>): number {
  const name = entry.name.toLowerCase();
  if (entry.isDirectory()) {
    if (name === "lib" || name === "src" || name === "config") return 0;
    if (name === "server" || name === "app" || name === "pages") return 1;
    if (name === "packages") return 2;
    if (name === "components") return 5;
    return 4;
  }
  if (/env|config|secret|setting/.test(name)) return 0;
  return 3;
}

function shouldScanEnvFile(fileName: string): boolean {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(fileName)) return false;
  const extension = fileName.match(/\.[^.]+$/)?.[0] ?? "";
  return ENV_SCAN_EXTENSIONS.has(extension);
}

function collectRequiredEnvKeys(source: string, keys: Set<string>): void {
  const patterns = [
    /\b(?:requireEnv|requiredEnv|getRequiredEnv|mustGetEnv|assertEnv)\(\s*["'`]([A-Z][A-Z0-9_]{1,})["'`]\s*\)/g,
    /\b(?:envRequired|requiredEnvVar)\(\s*["'`]([A-Z][A-Z0-9_]{1,})["'`]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }
}

function isImplicitUrlEnvKey(
  key: string,
  options: SandboxAppLaunchOptions,
): boolean {
  return (
    (options.urlEnvNames ?? []).includes(key) ||
    (options.inferUrlEnv !== false && DEFAULT_URL_ENV_NAMES.includes(key))
  );
}

function isImplicitHostEnvKey(
  key: string,
  options: SandboxAppLaunchOptions,
): boolean {
  return (
    (options.hostEnvNames ?? []).includes(key) ||
    (options.inferHostEnv !== false && DEFAULT_HOST_ENV_NAMES.includes(key))
  );
}

function isGeneratableSandboxSecretEnvKey(key: string): boolean {
  if (/^(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE|AWS|AZURE|STRIPE)_/i.test(key))
    return false;
  return /(?:JWT|SECRET|HMAC|SIGNING|ENCRYPTION|CREDENTIAL|SALT|COOKIE|SESSION|CSRF|MFA)/i.test(
    key,
  );
}

function generateSandboxSecret(key: string): string {
  return `testers-${key.toLowerCase().replace(/_/g, "-")}-${randomBytes(32).toString("hex")}`;
}

function applyPostgresEnv(
  env: Record<string, string>,
  postgres: SandboxAppPostgresOptions | undefined,
): Record<string, string> {
  if (!postgres?.enabled) return env;
  const url = buildPostgresUrl(
    postgres.user,
    postgres.password,
    postgres.port,
    postgres.database,
  );
  const directUrl = buildPostgresUrl(
    "postgres",
    postgres.password,
    postgres.port,
    postgres.database,
  );
  return {
    ...env,
    DATABASE_URL: url,
    DATABASE_DIRECT_URL: directUrl,
  };
}

function buildPostgresUrl(
  user: string,
  password: string,
  port: number,
  database: string,
): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath))
    throw new Error(`Sandbox app env file not found: ${filePath}`);
  const env: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    assertEnvVarName(key, normalized);
    env[key] = stripEnvQuotes(normalized.slice(separator + 1).trim());
  }
  return env;
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveUrlEnvNames(
  env: Record<string, string>,
  options: SandboxAppLaunchOptions,
): string[] {
  const names = new Set<string>();
  for (const name of options.urlEnvNames ?? []) {
    const key = name.trim();
    if (!key) continue;
    assertEnvVarName(key, name);
    names.add(key);
  }
  if (options.inferUrlEnv !== false) {
    for (const key of DEFAULT_URL_ENV_NAMES) {
      if (env[key] !== undefined) names.add(key);
    }
  }
  return [...names].sort();
}

function resolveHostEnvNames(
  env: Record<string, string>,
  options: SandboxAppLaunchOptions,
  framework: "next" | "vite" | "generic",
  mode: SandboxAppMode,
): string[] {
  const names = new Set<string>();
  for (const name of options.hostEnvNames ?? []) {
    const key = name.trim();
    if (!key) continue;
    assertEnvVarName(key, name);
    names.add(key);
  }
  if (options.inferHostEnv !== false) {
    for (const key of DEFAULT_HOST_ENV_NAMES) {
      if (env[key] !== undefined) names.add(key);
    }
    if (framework === "next" && mode === "dev") {
      for (const key of NEXT_DEV_HOST_ENV_NAMES) names.add(key);
    }
  }
  return [...names].sort();
}

function resolvePublicHost(publicUrl: string): string {
  try {
    const parsed = new URL(publicUrl);
    if (parsed.hostname) return parsed.hostname.toLowerCase();
  } catch {}
  const host = publicUrl
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
    .split(/[/?#]/, 1)[0]
    ?.replace(/:\d+$/, "")
    ?.trim();
  return host || "<sandbox-public-host>";
}

function mergeHostEnvValue(
  existing: string | undefined,
  publicHost: string,
): string {
  const names = new Set(
    (existing ?? "")
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  names.add(publicHost);
  return [...names].join(",");
}

function applyPublicEnv(
  env: Record<string, string>,
  publicUrl: string,
  publicHost: string,
  internalUrl: string,
  urlEnvNames: string[],
  hostEnvNames: string[],
): Record<string, string> {
  const next = { ...env };
  next.TESTERS_PUBLIC_URL = publicUrl;
  next.TESTERS_PUBLIC_HOST = publicHost;
  next.TESTERS_INTERNAL_URL = internalUrl;
  for (const name of urlEnvNames) next[name] = publicUrl;
  for (const name of hostEnvNames) {
    next[name] =
      name === "NEXT_ALLOWED_DEV_ORIGINS"
        ? mergeHostEnvValue(env[name], publicHost)
        : publicHost;
  }
  return next;
}

function detectPackageManager(
  sourceDir: string,
  appLocalDir: string = sourceDir,
): "npm" | "yarn" | "pnpm" | "bun" {
  const declared =
    readPackageManagerName(join(appLocalDir, "package.json")) ??
    readPackageManagerName(join(sourceDir, "package.json"));
  if (declared) return declared;
  if (existsSync(join(sourceDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(sourceDir, "pnpm-workspace.yaml"))) return "pnpm";
  if (existsSync(join(sourceDir, "yarn.lock"))) return "yarn";
  if (
    existsSync(join(sourceDir, "package-lock.json")) ||
    existsSync(join(sourceDir, "npm-shrinkwrap.json"))
  )
    return "npm";
  if (
    existsSync(join(sourceDir, "bun.lockb")) ||
    existsSync(join(sourceDir, "bun.lock"))
  )
    return "bun";
  return "npm";
}

function readPackageManagerName(
  packageJsonPath: string,
): "npm" | "yarn" | "pnpm" | "bun" | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const json = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      packageManager?: unknown;
    };
    if (typeof json.packageManager !== "string") return null;
    const name = json.packageManager.split("@")[0];
    if (name === "npm" || name === "yarn" || name === "pnpm" || name === "bun")
      return name;
  } catch {
    return null;
  }
  return null;
}

function readPackageInfo(appLocalDir: string): {
  scripts: Record<string, string>;
  deps: Record<string, string>;
  nextStandalone: boolean;
} {
  const packageJsonPath = join(appLocalDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `No package.json found in sandbox app working directory: ${appLocalDir}`,
    );
  }
  const json = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    scripts: json.scripts ?? {},
    deps: { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) },
    nextStandalone: detectNextStandaloneOutput(appLocalDir),
  };
}

function detectNextStandaloneOutput(appLocalDir: string): boolean {
  if (existsSync(join(appLocalDir, ".next", "standalone", "server.js"))) {
    return true;
  }

  for (const fileName of [
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "next.config.mts",
  ]) {
    const filePath = join(appLocalDir, fileName);
    if (!existsSync(filePath)) continue;
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_ENV_SCAN_FILE_BYTES) continue;
      const source = readFileSync(filePath, "utf-8");
      if (
        /\boutput\s*:\s*["']standalone["']/.test(source) ||
        /\boutput\s*=\s*["']standalone["']/.test(source)
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

function detectFramework(packageInfo: {
  deps: Record<string, string>;
}): "next" | "vite" | "generic" {
  if (packageInfo.deps.next) return "next";
  if (packageInfo.deps.vite) return "vite";
  return "generic";
}

function buildBootstrapCommand(
  packageManager: "npm" | "yarn" | "pnpm" | "bun",
  options: { needsBun?: boolean } = {},
): string {
  const lines = [
    "set -euo pipefail",
    'export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"',
    'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$PATH"',
    "SUDO=''",
    'if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO=\'sudo\'; fi',
    "ensure_apt_packages() {",
    "  if ! command -v apt-get >/dev/null 2>&1; then",
    '    echo "Missing required tools and apt-get is unavailable in this sandbox image" >&2',
    "    exit 1",
    "  fi",
    "  export DEBIAN_FRONTEND=noninteractive",
    "  $SUDO apt-get update",
    '  $SUDO apt-get install -y "$@"',
    "}",
    options.needsBun
      ? [
          "if ! command -v bun >/dev/null 2>&1; then",
          "  if ! command -v curl >/dev/null 2>&1; then",
          "    ensure_apt_packages curl ca-certificates unzip",
          "  fi",
          "  curl -fsSL https://bun.sh/install -o /tmp/testers-bun-install.sh",
          "  bash /tmp/testers-bun-install.sh || true",
          '  test -x "$BUN_INSTALL/bin/bun"',
          '  mkdir -p "$HOME/.local/bin"',
          '  ln -sf "$BUN_INSTALL/bin/bun" "$HOME/.local/bin/bun" 2>/dev/null || true',
          '  ln -sf "$BUN_INSTALL/bin/bun" "$HOME/.local/bin/bunx" 2>/dev/null || true',
          "fi",
          'export PATH="$BUN_INSTALL/bin:$HOME/.local/bin:$PATH"',
          "hash -r 2>/dev/null || true",
          'command -v bun >/dev/null 2>&1 || test -x "$BUN_INSTALL/bin/bun"',
        ].join("\n")
      : undefined,
    packageManager !== "bun"
      ? [
          "if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then",
          "  if ! command -v curl >/dev/null 2>&1; then ensure_apt_packages curl ca-certificates; fi",
          "  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/testers-node-setup.sh",
          "  $SUDO bash /tmp/testers-node-setup.sh",
          "  $SUDO apt-get install -y nodejs",
          "fi",
          "command -v node >/dev/null 2>&1",
          "command -v npm >/dev/null 2>&1",
        ].join("\n")
      : undefined,
    packageManager === "pnpm"
      ? [
          "if ! command -v pnpm >/dev/null 2>&1; then",
          "  corepack enable >/dev/null 2>&1 || true",
          "  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true",
          '  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm --prefix "$HOME/.local" || $SUDO npm install -g pnpm',
          "fi",
          "command -v pnpm >/dev/null 2>&1",
        ].join("\n")
      : undefined,
    packageManager === "yarn"
      ? [
          "if ! command -v yarn >/dev/null 2>&1; then",
          "  corepack enable >/dev/null 2>&1 || true",
          "  corepack prepare yarn@stable --activate >/dev/null 2>&1 || true",
          '  command -v yarn >/dev/null 2>&1 || npm install -g yarn --prefix "$HOME/.local" || $SUDO npm install -g yarn',
          "fi",
          "command -v yarn >/dev/null 2>&1",
        ].join("\n")
      : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

function shouldBootstrapBun(
  packageManager: "npm" | "yarn" | "pnpm" | "bun",
  packageInfo: { scripts: Record<string, string> },
  options: SandboxAppLaunchOptions,
): boolean {
  if (packageManager === "bun") return true;
  const commands = [
    ...Object.values(packageInfo.scripts),
    ...(options.setupCommands ?? []),
    ...(options.dbCommands ?? []),
    options.buildCommand &&
    options.buildCommand !== "auto" &&
    options.buildCommand !== "none"
      ? options.buildCommand
      : "",
    options.startCommand ?? "",
  ];
  return commands.some((command) => /\bbunx?\b/.test(command));
}

function resolveCommandSetting(
  setting: SandboxAppCommandSetting,
  auto: () => string,
): string | null {
  if (setting === "none") return null;
  if (setting === "auto") {
    const command = auto().trim();
    return command || null;
  }
  return setting.trim() || null;
}

function inferStartCommand(input: {
  packageManager: "npm" | "yarn" | "pnpm" | "bun";
  packageInfo: { scripts: Record<string, string>; nextStandalone?: boolean };
  framework: "next" | "vite" | "generic";
  mode: SandboxAppMode;
  port: number;
}): string {
  const script = input.mode === "prod" ? "start" : "dev";
  const scriptCommand = input.packageInfo.scripts[script];
  if (
    input.framework === "next" &&
    input.mode === "prod" &&
    input.packageInfo.nextStandalone &&
    (!scriptCommand || isNextStartScript(scriptCommand))
  ) {
    return buildNextStandaloneStartCommand(input.port);
  }
  if (!scriptCommand) {
    throw new Error(
      `No "${script}" script found. Pass --start to launch this app in ${input.mode} mode.`,
    );
  }
  if (input.framework === "next") {
    const args = [
      ...(!scriptControlsHost(scriptCommand) ? ["--hostname", "0.0.0.0"] : []),
      ...(!scriptControlsPort(scriptCommand)
        ? ["--port", String(input.port)]
        : []),
    ];
    return buildRunScriptCommand(input.packageManager, script, args);
  }
  if (input.framework === "vite") {
    const args = [
      ...(!scriptControlsHost(scriptCommand) ? ["--host", "0.0.0.0"] : []),
      ...(!scriptControlsPort(scriptCommand)
        ? ["--port", String(input.port)]
        : []),
    ];
    return buildRunScriptCommand(input.packageManager, script, args);
  }
  return buildRunScriptCommand(input.packageManager, script);
}

function isNextStartScript(command: string): boolean {
  return /(^|[\s;&|()])next\s+start(\s|$)/.test(command);
}

function scriptControlsHost(command: string): boolean {
  return /(^|\s)(--host|--hostname)(=|\s|$)/.test(command);
}

function scriptControlsPort(command: string): boolean {
  return /(^|\s)(--port|-p)(=|\s|$)/.test(command);
}

function buildRunScriptCommand(
  packageManager: "npm" | "yarn" | "pnpm" | "bun",
  script: string,
  args: string[] = [],
): string {
  const quotedArgs = args.map(shellQuote).join(" ");
  if (packageManager === "npm")
    return ["npm", "run", script, ...(args.length ? ["--", quotedArgs] : [])]
      .filter(Boolean)
      .join(" ");
  if (packageManager === "yarn")
    return ["yarn", script, quotedArgs].filter(Boolean).join(" ");
  return [
    packageManager,
    "run",
    script,
    ...(args.length ? ["--", quotedArgs] : []),
  ]
    .filter(Boolean)
    .join(" ");
}

function buildNextStandaloneStartCommand(port: number): string {
  const portValue = String(port);
  return [
    "set -euo pipefail",
    "if [ ! -f .next/standalone/server.js ]; then",
    '  echo "Next standalone server not found at .next/standalone/server.js. Run the production build or pass --start." >&2',
    "  exit 1",
    "fi",
    "mkdir -p .next/standalone/.next",
    "if [ -d .next/static ]; then",
    "  rm -rf .next/standalone/.next/static",
    "  cp -R .next/static .next/standalone/.next/static",
    "fi",
    "if [ -d public ]; then",
    "  rm -rf .next/standalone/public",
    "  cp -R public .next/standalone/public",
    "fi",
    `HOSTNAME=0.0.0.0 PORT=${shellQuote(portValue)} node .next/standalone/server.js`,
  ].join("\n");
}

function buildBackgroundStartCommand(
  startCommand: string,
  stateRemoteDir: string,
): string {
  const logPath = remoteJoin(stateRemoteDir, "app.log");
  const pidPath = remoteJoin(stateRemoteDir, "app.pid");
  return [
    "set -euo pipefail",
    `mkdir -p ${shellQuote(stateRemoteDir)}`,
    `: > ${shellQuote(logPath)}`,
    `( ${startCommand} ) > ${shellQuote(logPath)} 2>&1 &`,
    "APP_PID=$!",
    `echo "$APP_PID" > ${shellQuote(pidPath)}`,
    "sleep 1",
    'if ! kill -0 "$APP_PID" 2>/dev/null; then',
    `  cat ${shellQuote(logPath)} >&2 || true`,
    "  exit 1",
    "fi",
  ].join("\n");
}

function buildWaitForUrlCommand(
  url: string,
  timeoutMs: number,
  stateRemoteDir?: string,
  options: { stableChecks?: number; stableIntervalSeconds?: number } = {},
): string {
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const logPath = stateRemoteDir ? remoteJoin(stateRemoteDir, "app.log") : null;
  const pidPath = stateRemoteDir ? remoteJoin(stateRemoteDir, "app.pid") : null;
  const stableChecks = Math.max(1, options.stableChecks ?? 1);
  const stableIntervalSeconds = Math.max(
    1,
    options.stableIntervalSeconds ?? 2,
  );
  return [
    "set -uo pipefail",
    `export URL=${shellQuote(url)}`,
    `DEADLINE=$((SECONDS + ${timeoutSeconds}))`,
    `REQUIRED_SUCCESSES=${stableChecks}`,
    "SUCCESS_COUNT=0",
    "tail_app_log() {",
    logPath
      ? `  if [ -f ${shellQuote(logPath)} ]; then echo "--- app log tail ---" >&2; tail -200 ${shellQuote(logPath)} >&2 || true; fi`
      : "  return 0",
    "}",
    "check_app_pid() {",
    pidPath
      ? [
          `  APP_PID="$(cat ${shellQuote(pidPath)} 2>/dev/null || true)"`,
          '  if [ -n "$APP_PID" ] && ! kill -0 "$APP_PID" 2>/dev/null; then',
          '    echo "App process $APP_PID exited while waiting for $URL" >&2',
          "    tail_app_log",
          "    return 1",
          "  fi",
          "  return 0",
        ].join("\n")
      : "  return 0",
    "}",
    "probe_url() {",
    "  if command -v curl >/dev/null 2>&1; then",
    '    if curl -fsS -m 5 "$URL" >/dev/null 2>&1; then return 0; fi',
    "  fi",
    "  if command -v node >/dev/null 2>&1; then",
    '    if node -e "fetch(process.env.URL).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then return 0; fi',
    "  fi",
    "  return 1",
    "}",
    'while [ "$SECONDS" -le "$DEADLINE" ]; do',
    "  check_app_pid || exit 1",
    "  if probe_url; then",
    "    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))",
    '    if [ "$SUCCESS_COUNT" -ge "$REQUIRED_SUCCESSES" ]; then exit 0; fi',
    `    sleep ${stableIntervalSeconds}`,
    "    continue",
    "  fi",
    "  SUCCESS_COUNT=0",
    "  sleep 2",
    "done",
    'echo "Timed out waiting for $URL" >&2',
    "tail_app_log",
    "exit 1",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPostgresSetupCommand(options: SandboxAppPostgresOptions): string {
  const url = buildPostgresUrl(
    options.user,
    options.password,
    options.port,
    options.database,
  );
  const directUrl = buildPostgresUrl(
    "postgres",
    options.password,
    options.port,
    options.database,
  );
  const port = String(options.port);
  const userExistsSql = `SELECT 1 FROM pg_roles WHERE rolname = ${sqlLiteral(options.user)}`;
  const createUserSql = `CREATE USER ${quoteSqlIdentifier(options.user)} WITH PASSWORD ${sqlLiteral(options.password)} CREATEDB CREATEROLE`;
  const alterUserSql = `ALTER USER ${quoteSqlIdentifier(options.user)} WITH CREATEDB CREATEROLE`;
  const alterPostgresSql = `ALTER USER postgres WITH PASSWORD ${sqlLiteral(options.password)}`;
  const databaseExistsSql = `SELECT 1 FROM pg_database WHERE datname = ${sqlLiteral(options.database)}`;
  return [
    "set -euo pipefail",
    "SUDO=''",
    'if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO=\'sudo\'; fi',
    "run_as_postgres() {",
    '  if [ "$(id -un)" = "postgres" ]; then "$@"; return; fi',
    '  if command -v sudo >/dev/null 2>&1; then sudo -u postgres "$@"; return; fi',
    '  if command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"; return; fi',
    '  "$@"',
    "}",
    "if ! command -v psql >/dev/null 2>&1; then",
    "  if command -v apt-get >/dev/null 2>&1; then",
    "    export DEBIAN_FRONTEND=noninteractive",
    "    $SUDO apt-get update",
    "    $SUDO apt-get install -y postgresql postgresql-contrib",
    "  else",
    "    echo 'PostgreSQL setup needs psql or apt-get in the sandbox image' >&2",
    "    exit 1",
    "  fi",
    "fi",
    "$SUDO service postgresql start >/dev/null 2>&1 || $SUDO pg_ctlcluster --skip-systemctl-redirect 16 main start >/dev/null 2>&1 || $SUDO pg_ctlcluster --skip-systemctl-redirect 15 main start >/dev/null 2>&1 || $SUDO pg_ctlcluster --skip-systemctl-redirect 14 main start >/dev/null 2>&1 || true",
    port !== "5432"
      ? [
          `run_as_postgres psql -tc "SHOW port" | grep -q ${shellQuote(port)} || run_as_postgres psql -c "ALTER SYSTEM SET port = '${port}'"`,
          "$SUDO service postgresql restart >/dev/null 2>&1 || $SUDO pg_ctlcluster --skip-systemctl-redirect 16 main restart >/dev/null 2>&1 || $SUDO pg_ctlcluster --skip-systemctl-redirect 15 main restart >/dev/null 2>&1 || $SUDO pg_ctlcluster --skip-systemctl-redirect 14 main restart >/dev/null 2>&1 || true",
        ].join("\n")
      : undefined,
    `for _ in $(seq 1 30); do run_as_postgres pg_isready -p ${shellQuote(port)} >/dev/null 2>&1 && break; sleep 1; done`,
    `${buildPsqlCommand(options, { sql: userExistsSql, tuplesOnly: true })} | grep -q 1 || ${buildPsqlCommand(options, { sql: createUserSql })}`,
    buildPsqlCommand(options, { sql: alterUserSql }),
    buildPsqlCommand(options, { sql: alterPostgresSql }),
    `${buildPsqlCommand(options, { sql: databaseExistsSql, tuplesOnly: true })} | grep -q 1 || run_as_postgres createdb -p ${shellQuote(port)} -O ${shellQuote(options.user)} ${shellQuote(options.database)}`,
    buildPostgresGrantStatements(options),
    `echo ${shellQuote(`DATABASE_URL=${url}`)} > /tmp/testers-postgres.env`,
    `echo ${shellQuote(`DATABASE_DIRECT_URL=${directUrl}`)} >> /tmp/testers-postgres.env`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPostgresGrantCommand(options: SandboxAppPostgresOptions): string {
  return [
    "set -euo pipefail",
    buildRunAsPostgresFunction(),
    buildPostgresGrantStatements(options),
  ].join("\n");
}

function buildRunAsPostgresFunction(): string {
  return [
    "run_as_postgres() {",
    '  if [ "$(id -un)" = "postgres" ]; then "$@"; return; fi',
    '  if command -v sudo >/dev/null 2>&1; then sudo -u postgres "$@"; return; fi',
    '  if command -v runuser >/dev/null 2>&1; then runuser -u postgres -- "$@"; return; fi',
    '  "$@"',
    "}",
  ].join("\n");
}

function buildPostgresGrantStatements(
  options: SandboxAppPostgresOptions,
): string {
  const role = quoteSqlIdentifier(options.user);
  const lines: string[] = [];
  for (const schema of ["public", "app"]) {
    const schemaIdentifier = quoteSqlIdentifier(schema);
    lines.push(
      `if ${buildPsqlCommand(options, { database: options.database, sql: `SELECT 1 FROM pg_namespace WHERE nspname = ${sqlLiteral(schema)}`, tuplesOnly: true })} | grep -q 1; then`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `GRANT USAGE ON SCHEMA ${schemaIdentifier} TO ${role}` })}`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schemaIdentifier} TO ${role}` })}`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schemaIdentifier} TO ${role}` })}`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schemaIdentifier} TO ${role}` })}`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT ALL PRIVILEGES ON TABLES TO ${role}` })}`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT ALL PRIVILEGES ON SEQUENCES TO ${role}` })}`,
    );
    lines.push(
      `  ${buildPsqlCommand(options, { database: options.database, sql: `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdentifier} GRANT EXECUTE ON FUNCTIONS TO ${role}` })}`,
    );
    lines.push("fi");
  }
  if (options.grantCreatedRoles !== false) {
    lines.push(buildPostgresCreatedRoleGrantCommand(options));
  }
  return lines.join("\n");
}

function buildPostgresCreatedRoleGrantCommand(
  options: SandboxAppPostgresOptions,
): string {
  const targetRole = sqlLiteral(options.user);
  return buildPsqlCommand(options, {
    database: options.database,
    sql: `
DO $$
DECLARE
  target_role name := ${targetRole};
  migration_role name := current_user;
  inherited_role name;
BEGIN
  FOR inherited_role IN
    SELECT child.rolname
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.member
    JOIN pg_roles child ON child.oid = membership.roleid
    WHERE parent.rolname = migration_role
      AND NOT child.rolcanlogin
      AND child.rolname !~ '^pg_'
      AND child.rolname <> target_role
      AND NOT pg_has_role(target_role, child.oid, 'member')
  LOOP
    EXECUTE format('GRANT %I TO %I', inherited_role, target_role);
  END LOOP;
END
$$;
`.trim(),
  });
}

function buildPsqlCommand(
  options: SandboxAppPostgresOptions,
  command: { database?: string; sql: string; tuplesOnly?: boolean },
): string {
  return [
    "run_as_postgres",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-p",
    shellQuote(String(options.port)),
    command.database ? `-d ${shellQuote(command.database)}` : undefined,
    command.tuplesOnly ? "-tc" : "-c",
    shellQuote(command.sql),
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizeWaitUrl(
  waitUrl: string | undefined,
  internalUrl: string,
): string {
  if (!waitUrl?.trim()) return internalUrl;
  const trimmed = waitUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
  if (trimmed.startsWith("/"))
    return `${internalUrl.replace(/\/+$/, "")}${trimmed}`;
  return trimmed;
}

function normalizePublicWaitUrl(
  waitUrl: string,
  internalUrl: string,
  publicUrl: string,
): string {
  const publicBase = publicUrl.replace(/\/+$/, "");
  try {
    const wait = new URL(waitUrl);
    const internal = new URL(internalUrl);
    if (isInternalWaitOrigin(wait, internal)) {
      return `${publicBase}${wait.pathname}${wait.search}${wait.hash}`;
    }
  } catch {
    return publicBase;
  }
  return publicBase;
}

function isInternalWaitOrigin(wait: URL, internal: URL): boolean {
  const localHosts = new Set(["127.0.0.1", "localhost", "0.0.0.0"]);
  return (
    wait.protocol === internal.protocol &&
    wait.port === internal.port &&
    localHosts.has(wait.hostname) &&
    localHosts.has(internal.hostname)
  );
}

function normalizeRelativeWorkingDir(value: string | undefined): string {
  if (!value?.trim()) return ".";
  const normalized = value.trim();
  if (isAbsolute(normalized))
    throw new Error(
      "Sandbox app working directory must be relative to the source directory",
    );
  const relativePath = relative(".", normalized).split(sep).join("/");
  if (relativePath.startsWith(".."))
    throw new Error(
      "Sandbox app working directory must be inside the source directory",
    );
  return relativePath || ".";
}

function normalizeRemoteDir(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/"))
    throw new Error("Sandbox remote directory must be an absolute POSIX path");
  return trimmed.replace(/\/+$/, "") || "/";
}

function defaultRemoteDir(
  provider: string | undefined,
  timestamp: number,
): string {
  const suffix = `testers-app-${timestamp.toString(36)}`;
  if (provider?.toLowerCase() === "e2b") return `/home/user/${suffix}`;
  return `/tmp/${suffix}`;
}

function remoteJoin(base: string, child: string): string {
  const normalizedChild = child === "." ? "" : child.replace(/^\/+/, "");
  return pathPosix.join(base, normalizedChild);
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 65535)
    throw new Error(`Invalid sandbox app port: ${value}`);
  return value;
}

function assertDirectory(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  if (!statSync(path).isDirectory())
    throw new Error(`${label} is not a directory: ${path}`);
}

function assertEnvVarName(key: string, rawValue: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid sandbox app env var name: ${key || rawValue}`);
  }
}

function isSecretLikeEnvKey(key: string): boolean {
  return /(?:SECRET|TOKEN|PASSWORD|PASS|PRIVATE|KEY|CREDENTIAL|DSN|DATABASE_URL|DATABASE_DIRECT_URL|AUTH)/i.test(
    key,
  );
}

function isCredentialReference(value: string): boolean {
  return value.startsWith("$") || value.startsWith("@secrets:");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteSqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function appendCapturedOutput(current: string, data: string): string {
  const next = current + data;
  if (next.length <= MAX_CAPTURED_OUTPUT) return next;
  return next.slice(next.length - MAX_CAPTURED_OUTPUT);
}

function formatCapturedOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(`\nstdout:\n${stdout.trimEnd()}`);
  if (stderr.trim()) parts.push(`\nstderr:\n${stderr.trimEnd()}`);
  return parts.join("");
}

function stateFilePath(): string {
  const dir = getTestersDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, "sandbox-app-launches.json");
}

function readSandboxAppLaunches(): SandboxAppLaunchRecord[] {
  const file = stateFilePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SandboxAppLaunchRecord[]) : [];
  } catch {
    return [];
  }
}

function writeSandboxAppLaunches(records: SandboxAppLaunchRecord[]): void {
  const file = stateFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(records, null, 2) + "\n", "utf-8");
}

function saveSandboxAppLaunch(result: SandboxAppLaunchResult, now: Date): void {
  const records = readSandboxAppLaunches().filter(
    (record) => record.sandboxId !== result.sandboxId,
  );
  records.push({
    sandboxId: result.sandboxId,
    provider: result.provider,
    publicUrl: result.publicUrl,
    publicHost: result.publicHost,
    internalUrl: result.internalUrl,
    sourceDir: result.sourceDir,
    workingDir: result.workingDir,
    remoteDir: result.remoteDir,
    appRemoteDir: result.appRemoteDir,
    stateRemoteDir: result.stateRemoteDir,
    mode: result.mode,
    port: result.port,
    createdAt: now.toISOString(),
    expiresAt: result.expiresAt,
  });
  writeSandboxAppLaunches(records);
}

function findSandboxAppLaunch(id: string): SandboxAppLaunchRecord | undefined {
  const records = readSandboxAppLaunches();
  return (
    records.find((record) => record.sandboxId === id) ??
    records.find((record) => record.sandboxId.startsWith(id))
  );
}

function removeSandboxAppLaunch(id: string): void {
  writeSandboxAppLaunches(
    readSandboxAppLaunches().filter((record) => record.sandboxId !== id),
  );
}
