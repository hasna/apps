import type { Browser, Page } from "playwright";
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { BrowserError } from "../types/index.js";
import { assertBrowserCapability } from "../lib/policy.js";
import { saveToDownloads } from "../lib/downloads.js";
import { connectToExistingBrowser } from "./cdp.js";

const kernelApiEnvName = ["KERNEL", "API", "KEY"].join("_");
const moduleRequire = createRequire(import.meta.url);

export const KERNEL_API_KEY_SECRET_KEY = ["hasna", "xyz", "opensource", "browser", "prod", "kernel_api_key"].join("/");

export type KernelAuthMode = "managed" | "cdp_autofill" | "auto" | "off";

export interface KernelCreateOptions {
  apiKey?: string;
  projectId?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
  startUrl?: string;
  name?: string;
  headless?: boolean;
  stealth?: boolean;
  viewport?: { width: number; height: number };
  timeoutSeconds?: number;
  persistenceId?: string;
  profileId?: string;
  profileName?: string;
  saveProfileChanges?: boolean;
  proxyId?: string;
  gpu?: boolean;
  kioskMode?: boolean;
  tags?: Record<string, string>;
  telemetry?: Record<string, unknown> | boolean;
  chromePolicy?: Record<string, unknown>;
  extensions?: Array<{ id?: string; name?: string }>;
  env?: Record<string, string>;
  envSecrets?: Record<string, string>;
  authMode?: KernelAuthMode;
  approvalToken?: string;
}

export interface KernelBrowserMetadata {
  sessionId: string;
  cdpWsUrl: string;
  webdriverWsUrl?: string;
  browserLiveViewUrl?: string;
  baseUrl?: string;
  persistenceId?: string;
  name?: string;
  headless?: boolean;
  stealth?: boolean;
  timeoutSeconds?: number;
  proxyId?: string;
  gpu?: boolean;
  kioskMode?: boolean;
  authConnectionId?: string;
  authStatus?: string;
  authLiveViewUrl?: string;
  authFallback?: "cdp_autofill";
}

export interface KernelSandbox {
  client: KernelClientLike;
  metadata: KernelBrowserMetadata;
}

export interface KernelConnectedBrowser {
  browser: Browser;
  metadata: KernelBrowserMetadata;
  close: () => Promise<void>;
}

export interface VaultItemMetadata {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  domains: string[];
  tags?: string[];
}

export interface VaultItem extends VaultItemMetadata {
  data: Record<string, unknown>;
}

export interface KernelSecretsProvider {
  getSecretValue(key: string): Promise<string | undefined>;
  setSecretValue?(
    key: string,
    value: string,
    opts?: { type?: string; label?: string },
  ): Promise<void>;
  matchVaultItemsForUrl(url: string): Promise<VaultItemMetadata[]>;
  getVaultItem(id: string): Promise<VaultItem | undefined>;
}

type KernelBrowserCreateParams = {
  chrome_policy?: Record<string, unknown>;
  extensions?: Array<{ id?: string; name?: string }>;
  gpu?: boolean;
  headless?: boolean;
  kiosk_mode?: boolean;
  name?: string;
  profile?: { id?: string; name?: string; save_changes?: boolean };
  proxy_id?: string;
  start_url?: string;
  stealth?: boolean;
  tags?: Record<string, string>;
  telemetry?: Record<string, unknown> | boolean | null;
  timeout_seconds?: number;
  viewport?: { width: number; height: number };
  [key: string]: unknown;
};

type KernelBrowserCreateResponse = {
  cdp_ws_url: string;
  session_id: string;
  webdriver_ws_url?: string;
  browser_live_view_url?: string;
  base_url?: string;
  persistence_id?: string;
  profile?: { id?: string; name?: string | null };
  created_at?: string;
  deleted_at?: string;
  headless?: boolean;
  stealth?: boolean;
  timeout_seconds?: number;
  name?: string;
  proxy_id?: string;
  gpu?: boolean;
  kiosk_mode?: boolean;
  start_url?: string;
  tags?: Record<string, string>;
  usage?: Record<string, unknown>;
  telemetry?: unknown;
};

type KernelCredentialParams = {
  domain: string;
  name: string;
  values: Record<string, string>;
  totp_secret?: string;
};

type KernelManagedAuth = {
  id: string;
  domain: string;
  profile_name: string;
  status: "AUTHENTICATED" | "NEEDS_AUTH";
  flow_status?: "IN_PROGRESS" | "SUCCESS" | "FAILED" | "EXPIRED" | "CANCELED" | null;
  live_view_url?: string | null;
  error_message?: string | null;
};

type KernelLoginResponse = {
  id: string;
  live_view_url?: string;
};

interface KernelClientLike {
  browsers: {
    create(params?: KernelBrowserCreateParams | null): Promise<KernelBrowserCreateResponse>;
    retrieve?(idOrName: string, query?: { include_deleted?: boolean } | null): Promise<KernelBrowserCreateResponse>;
    list?(params?: { status?: string; limit?: number; [key: string]: unknown }): AsyncIterable<KernelBrowserCreateResponse> | Promise<{ items?: KernelBrowserCreateResponse[]; data?: KernelBrowserCreateResponse[] }>;
    deleteByID(idOrName: string): Promise<void>;
    fs?: {
      fileInfo(id: string, query: { path: string }): Promise<KernelFileInfo>;
      listFiles(id: string, query: { path: string }): Promise<KernelFileInfo[]>;
      readFile(id: string, query: { path: string }): Promise<Response>;
      downloadDirZip?(id: string, query: { path: string }): Promise<Response>;
    };
    computer?: {
      captureScreenshot(id: string, body?: { region?: { x: number; y: number; width: number; height: number } } | null): Promise<Response>;
      clickMouse?(id: string, body: Record<string, unknown>): Promise<void>;
      moveMouse?(id: string, body: Record<string, unknown>): Promise<void>;
      typeText?(id: string, body: Record<string, unknown>): Promise<void>;
      pressKey?(id: string, body: Record<string, unknown>): Promise<void>;
      scroll?(id: string, body: Record<string, unknown>): Promise<void>;
      batch?(id: string, body: { actions: Array<Record<string, unknown>> }): Promise<void>;
    };
    playwright?: {
      execute(id: string, body: { code: string; timeout_sec?: number }): Promise<KernelPlaywrightResult>;
    };
    replays?: {
      list(id: string): Promise<KernelReplayInfo[]>;
      start(id: string, body?: { framerate?: number; max_duration_in_seconds?: number; record_audio?: boolean } | null): Promise<KernelReplayInfo>;
      stop(replayId: string, params: { id: string }): Promise<void>;
      download(replayId: string, params: { id: string }): Promise<Response>;
    };
  };
  profiles?: {
    create(params: { name?: string }): Promise<unknown>;
    retrieve?(idOrName: string): Promise<unknown>;
  };
  credentials?: {
    create(params: KernelCredentialParams): Promise<unknown>;
    update?(idOrName: string, params: Partial<KernelCredentialParams>): Promise<unknown>;
  };
  auth?: {
    connections?: {
      create(params: {
        domain: string;
        profile_name: string;
        credential?: { name: string };
        login_url?: string;
        save_credentials?: boolean;
        record_session?: boolean;
      }): Promise<KernelManagedAuth>;
      retrieve(id: string): Promise<KernelManagedAuth>;
      login(id: string, params?: { record_session?: boolean }): Promise<KernelLoginResponse>;
      list?(params?: { domain?: string; profile_name?: string }): AsyncIterable<KernelManagedAuth> | Promise<{ items?: KernelManagedAuth[] }>;
    };
  };
}

export interface KernelClientConfig {
  projectId?: string;
  baseUrl?: string;
  requestTimeoutMs?: number;
}

export interface KernelFileInfo {
  is_dir: boolean;
  mod_time: string;
  mode: string;
  name: string;
  path: string;
  size_bytes: number;
}

export interface KernelReplayInfo {
  replay_id: string;
  replay_view_url?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface KernelPlaywrightResult {
  success: boolean;
  result?: unknown;
  error?: string;
  stdout?: string;
  stderr?: string;
}

export interface KernelRuntimeStatus {
  available: boolean;
  configured: boolean;
  apiKeySource: "vault" | "env" | "missing";
  vaultRef: string;
  projectIdConfigured: boolean;
  baseUrlConfigured: boolean;
  sdkVersion?: string;
  remote?: {
    ok: boolean;
    activeSessions?: number;
    error?: string;
    code?: string;
  };
  setup: {
    env: string;
    vault: string;
    statusCommand: string;
  };
}

export const kernelCredentialVaultRef = KERNEL_API_KEY_SECRET_KEY;

type KernelClientFactory = (apiKey: string, config?: KernelClientConfig) => KernelClientLike | Promise<KernelClientLike>;
type KernelCdpConnector = (cdpUrl: string, options?: { timeoutMs?: number }) => Promise<Browser>;

let kernelClientFactoryOverride: KernelClientFactory | undefined;
let secretsProviderOverride: KernelSecretsProvider | undefined;
let cdpConnectorOverride: KernelCdpConnector | undefined;
let cachedSecretsProvider: KernelSecretsProvider | undefined;

export function setKernelClientFactoryForTests(factory?: KernelClientFactory): void {
  kernelClientFactoryOverride = factory;
}

export function setKernelSecretsProviderForTests(provider?: KernelSecretsProvider): void {
  secretsProviderOverride = provider;
  cachedSecretsProvider = undefined;
}

export function setKernelCdpConnectorForTests(connector?: KernelCdpConnector): void {
  cdpConnectorOverride = connector;
}

async function createKernelClient(apiKey: string, config: KernelClientConfig = {}): Promise<KernelClientLike> {
  if (kernelClientFactoryOverride) return kernelClientFactoryOverride(apiKey, config);
  const moduleName = "@onkernel/sdk";
  const mod = await import(moduleName);
  const Kernel = (mod as { default?: new (opts: { apiKey: string; projectID?: string; baseURL?: string; timeout?: number }) => KernelClientLike; Kernel?: new (opts: { apiKey: string; projectID?: string; baseURL?: string; timeout?: number }) => KernelClientLike }).default
    ?? (mod as { Kernel?: new (opts: { apiKey: string; projectID?: string; baseURL?: string; timeout?: number }) => KernelClientLike }).Kernel;
  if (!Kernel) throw new BrowserError("@onkernel/sdk did not export Kernel", "KERNEL_SDK_INVALID", true);
  return new Kernel({
    apiKey,
    ...(config.projectId ? { projectID: config.projectId } : {}),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.requestTimeoutMs ? { timeout: config.requestTimeoutMs } : {}),
  });
}

async function getSecretsProvider(): Promise<KernelSecretsProvider> {
  if (secretsProviderOverride) return secretsProviderOverride;
  if (cachedSecretsProvider) return cachedSecretsProvider;
  cachedSecretsProvider = await createDefaultSecretsProvider();
  return cachedSecretsProvider;
}

export async function resolveKernelApiKey(secrets?: KernelSecretsProvider): Promise<string> {
  const resolved = await resolveKernelApiKeyWithSource(secrets);
  return resolved.value;
}

const KERNEL_API_KEY_READ_MAX_ATTEMPTS = 3;
const KERNEL_API_KEY_READ_RETRY_BASE_MS = 200;

/**
 * Read the Kernel API key from the vault, retrying transient read failures.
 *
 * Returns the trimmed key when present, or `undefined` for a *genuine* absence
 * (the read resolved cleanly with no value). A genuine absence is never retried
 * — retrying a missing secret is pointless. If every attempt throws, the vault
 * read is treated as a transient failure and a retryable `KERNEL_API_KEY_READ_FAILED`
 * error is raised so callers never mistake an unhealthy store for a missing key.
 */
async function readKernelKeyFromVault(provider: KernelSecretsProvider): Promise<string | undefined> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= KERNEL_API_KEY_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const value = (await provider.getSecretValue(kernelCredentialVaultRef))?.trim();
      return value || undefined;
    } catch (err) {
      lastError = err;
      if (attempt < KERNEL_API_KEY_READ_MAX_ATTEMPTS) {
        await sleep(KERNEL_API_KEY_READ_RETRY_BASE_MS * attempt);
      }
    }
  }
  throw toRedactedKernelError(
    lastError,
    `Failed to read the Kernel API key from @hasna/secrets at '${kernelCredentialVaultRef}' after ${KERNEL_API_KEY_READ_MAX_ATTEMPTS} attempts`,
    "KERNEL_API_KEY_READ_FAILED",
  );
}

async function resolveKernelApiKeyWithSource(secrets?: KernelSecretsProvider): Promise<{ value: string; source: "vault" | "env" }> {
  const provider = secrets ?? await getSecretsProvider();

  let vaultReadError: BrowserError | undefined;
  let vaultValue: string | undefined;
  try {
    vaultValue = await readKernelKeyFromVault(provider);
  } catch (err) {
    // Transient vault read failure (all retries exhausted). Hold onto it so an
    // explicit env key can still satisfy the request, but never let it masquerade
    // as a missing key.
    vaultReadError = err instanceof BrowserError
      ? err
      : toRedactedKernelError(err, "Failed to read the Kernel API key from @hasna/secrets", "KERNEL_API_KEY_READ_FAILED");
  }
  if (vaultValue) return { value: vaultValue, source: "vault" };

  const envValue = process.env["KERNEL_API_KEY"]?.trim();
  if (envValue) {
    await provider.setSecretValue?.(kernelCredentialVaultRef, envValue, {
      type: "api_key",
      label: "Kernel API key for @hasna/browser",
    }).catch(() => {});
    return { value: envValue, source: "env" };
  }

  // No usable key. Distinguish a transient read failure (retryable) from a genuine
  // absence so operators are not told the key is missing when it actually exists.
  if (vaultReadError) throw vaultReadError;

  throw new BrowserError(
    `Kernel API key not found. Store it in @hasna/secrets at '${kernelCredentialVaultRef}' or set ${kernelApiEnvName} for this process.`,
    "KERNEL_API_KEY_MISSING",
    true,
  );
}

function resolveKernelClientConfig(options: KernelCreateOptions = {}): KernelClientConfig {
  return {
    projectId: options.projectId ?? process.env["KERNEL_PROJECT_ID"]?.trim() ?? undefined,
    baseUrl: options.baseUrl ?? process.env["KERNEL_BASE_URL"]?.trim() ?? undefined,
    requestTimeoutMs: options.requestTimeoutMs,
  };
}

export async function createKernelSandbox(options: KernelCreateOptions = {}): Promise<KernelSandbox> {
  if (options.stealth) {
    assertBrowserCapability("stealth", { approvalToken: options.approvalToken });
  }

  const secrets = await getSecretsProvider();
  const apiKey = options.apiKey?.trim() || await resolveKernelApiKey(secrets);
  const client = await createKernelClient(apiKey, resolveKernelClientConfig(options));
  const authMode = options.authMode ?? (options.startUrl ? "managed" : "off");

  let auth: Awaited<ReturnType<typeof prepareKernelManagedAuth>> | undefined;
  if (options.startUrl && (authMode === "managed" || authMode === "auto")) {
    try {
      auth = await prepareKernelManagedAuth(client, options.startUrl, {
        persistenceId: options.persistenceId,
        secrets,
      });
    } catch (err) {
      if (authMode === "managed") throw err;
      auth = { authStatus: "MANAGED_AUTH_FAILED", authFallback: "cdp_autofill" };
    }
  }

  const env = await resolveKernelEnv(options, secrets);
  const persistenceId = auth?.persistenceId
    ?? options.profileName
    ?? options.persistenceId
    ?? process.env["OPEN_BROWSER_KERNEL_PERSISTENCE_ID"]?.trim()
    ?? undefined;

  const createParams: KernelBrowserCreateParams = {
    headless: options.headless ?? true,
    start_url: options.startUrl,
    name: options.name,
    timeout_seconds: options.timeoutSeconds,
    viewport: options.viewport,
  };
  if (options.chromePolicy) createParams.chrome_policy = options.chromePolicy;
  if (options.extensions?.length) createParams.extensions = options.extensions;
  if (typeof options.gpu === "boolean") createParams.gpu = options.gpu;
  if (typeof options.kioskMode === "boolean") createParams.kiosk_mode = options.kioskMode;
  if (options.stealth) createParams.stealth = true;
  if (options.proxyId) createParams.proxy_id = options.proxyId;
  if (options.tags && Object.keys(options.tags).length > 0) createParams.tags = options.tags;
  if (typeof options.telemetry !== "undefined") createParams.telemetry = options.telemetry;
  if (persistenceId && !auth?.authConnectionId) {
    await ensureKernelProfile(client, persistenceId);
  }
  if (options.profileId) {
    createParams.profile = { id: options.profileId, save_changes: options.saveProfileChanges ?? true };
  } else if (persistenceId) {
    createParams.profile = { name: persistenceId, save_changes: options.saveProfileChanges ?? true };
  }
  if (Object.keys(env).length > 0) createParams.env = env;

  let browser: KernelBrowserCreateResponse;
  try {
    browser = await client.browsers.create(createParams);
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to create Kernel browser session", "KERNEL_CREATE_FAILED");
  }
  return {
    client,
    metadata: {
      sessionId: browser.session_id,
      cdpWsUrl: browser.cdp_ws_url,
      webdriverWsUrl: browser.webdriver_ws_url,
      browserLiveViewUrl: browser.browser_live_view_url,
      baseUrl: browser.base_url,
      persistenceId: browser.persistence_id ?? options.profileId ?? persistenceId ?? browser.profile?.id ?? browser.profile?.name ?? undefined,
      name: browser.name,
      headless: browser.headless,
      stealth: browser.stealth,
      timeoutSeconds: browser.timeout_seconds,
      proxyId: browser.proxy_id,
      gpu: browser.gpu,
      kioskMode: browser.kiosk_mode,
      authConnectionId: auth?.authConnectionId,
      authStatus: auth?.authStatus,
      authLiveViewUrl: auth?.authLiveViewUrl,
      authFallback: auth?.authFallback,
    },
  };
}

export async function closeKernelSandbox(sandbox: KernelSandbox): Promise<void> {
  await sandbox.client.browsers.deleteByID(sandbox.metadata.sessionId);
}

export async function deleteKernelBrowser(idOrName: string, options: KernelCreateOptions = {}): Promise<{ deleted: string }> {
  const client = await createConfiguredKernelClient(options);
  try {
    await client.browsers.deleteByID(idOrName);
    return { deleted: idOrName };
  } catch (err) {
    throw toRedactedKernelError(err, `Failed to delete Kernel browser '${idOrName}'`, "KERNEL_DELETE_FAILED");
  }
}

export async function connectKernelBrowser(options: KernelCreateOptions = {}): Promise<KernelConnectedBrowser> {
  const sandbox = await createKernelSandbox(options);
  const connector = cdpConnectorOverride ?? connectToExistingBrowser;
  try {
    const browser = await connector(sandbox.metadata.cdpWsUrl, {
      timeoutMs: options.requestTimeoutMs ?? 120_000,
    });
    return {
      browser,
      metadata: sandbox.metadata,
      close: () => closeKernelSandbox(sandbox),
    };
  } catch (err) {
    await closeKernelSandbox(sandbox).catch(() => {});
    throw new BrowserError(
      `Failed to connect to Kernel browser via CDP: ${err instanceof Error ? redactKernelSensitiveText(err.message) : "unknown error"}`,
      "KERNEL_CDP_CONNECT_FAILED",
      true,
    );
  }
}

export async function getKernelStatus(options: KernelCreateOptions & { checkRemote?: boolean; listLimit?: number } = {}): Promise<KernelRuntimeStatus> {
  const setup = {
    env: "provide KERNEL_API_KEY in the process environment",
    vault: `secrets set ${kernelCredentialVaultRef} <key>`,
    statusCommand: "browser kernel status --remote",
  };

  let sdkVersion: string | undefined;
  let sdkAvailable = true;
  try {
    const pkgPath = moduleRequire.resolve("@onkernel/sdk/package.json");
    sdkVersion = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version;
  } catch {
    sdkAvailable = false;
  }

  let source: "vault" | "env" | "missing" = "missing";
  let apiKey: string | undefined;
  try {
    const resolved = options.apiKey?.trim()
      ? { value: options.apiKey.trim(), source: "env" as const }
      : await resolveKernelApiKeyWithSource(await getSecretsProvider());
    apiKey = resolved.value;
    source = options.apiKey?.trim() ? "env" : resolved.source;
  } catch {
    return {
      available: sdkAvailable,
      configured: false,
      apiKeySource: "missing",
      vaultRef: kernelCredentialVaultRef,
      projectIdConfigured: Boolean(options.projectId ?? process.env["KERNEL_PROJECT_ID"]?.trim()),
      baseUrlConfigured: Boolean(options.baseUrl ?? process.env["KERNEL_BASE_URL"]?.trim()),
      sdkVersion,
      setup,
    };
  }

  const status: KernelRuntimeStatus = {
    available: sdkAvailable,
    configured: true,
    apiKeySource: source,
    vaultRef: kernelCredentialVaultRef,
    projectIdConfigured: Boolean(options.projectId ?? process.env["KERNEL_PROJECT_ID"]?.trim()),
    baseUrlConfigured: Boolean(options.baseUrl ?? process.env["KERNEL_BASE_URL"]?.trim()),
    sdkVersion,
    setup,
  };

  if (options.checkRemote && apiKey) {
    try {
      const client = await createKernelClient(apiKey, resolveKernelClientConfig(options));
      const sessions = await listKernelBrowsersWithClient(client, { limit: options.listLimit ?? 25, status: "active" });
      status.remote = { ok: true, activeSessions: sessions.length };
    } catch (err) {
      status.remote = {
        ok: false,
        error: redactKernelSensitiveText(err instanceof Error ? err.message : String(err)),
        code: err instanceof BrowserError ? err.code : "KERNEL_STATUS_FAILED",
      };
    }
  }

  return status;
}

export async function retrieveKernelBrowser(idOrName: string, options: KernelCreateOptions = {}): Promise<Record<string, unknown>> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.retrieve) throw new BrowserError("Kernel SDK does not expose browser retrieve", "KERNEL_STATUS_UNAVAILABLE", true);
  try {
    return sanitizeKernelBrowser(await client.browsers.retrieve(idOrName, { include_deleted: true }));
  } catch (err) {
    throw toRedactedKernelError(err, `Failed to retrieve Kernel browser '${idOrName}'`, "KERNEL_RETRIEVE_FAILED");
  }
}

export async function listKernelBrowsers(options: KernelCreateOptions & { status?: string; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
  const client = await createConfiguredKernelClient(options);
  const sessions = await listKernelBrowsersWithClient(client, options);
  return sessions.map(sanitizeKernelBrowser);
}

export async function listKernelFiles(sessionId: string, remotePath = "/", options: KernelCreateOptions = {}): Promise<KernelFileInfo[]> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.fs?.listFiles) throw new BrowserError("Kernel SDK does not expose browser filesystem listFiles", "KERNEL_FS_UNAVAILABLE", true);
  try {
    return await client.browsers.fs.listFiles(sessionId, { path: remotePath });
  } catch (err) {
    throw toRedactedKernelError(err, `Failed to list Kernel files at '${remotePath}'`, "KERNEL_FS_LIST_FAILED");
  }
}

export async function getKernelFileInfo(sessionId: string, remotePath: string, options: KernelCreateOptions = {}): Promise<KernelFileInfo> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.fs?.fileInfo) throw new BrowserError("Kernel SDK does not expose browser filesystem fileInfo", "KERNEL_FS_UNAVAILABLE", true);
  try {
    return await client.browsers.fs.fileInfo(sessionId, { path: remotePath });
  } catch (err) {
    throw toRedactedKernelError(err, `Failed to inspect Kernel file '${remotePath}'`, "KERNEL_FS_INFO_FAILED");
  }
}

export async function downloadKernelFileToDownloads(
  sessionId: string,
  remotePath: string,
  options: KernelCreateOptions & { localSessionId?: string; filename?: string } = {},
) {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.fs?.readFile) throw new BrowserError("Kernel SDK does not expose browser filesystem readFile", "KERNEL_FS_UNAVAILABLE", true);
  try {
    const response = await client.browsers.fs.readFile(sessionId, { path: remotePath });
    const buffer = Buffer.from(await response.arrayBuffer());
    return saveToDownloads(buffer, (options.filename ?? basename(remotePath)) || "kernel-file", {
      sessionId: options.localSessionId,
      type: "kernel-file",
      sourceUrl: `kernel://${sessionId}${remotePath}`,
      metadata: { remote_path: remotePath, kernel_session_id: sessionId },
    });
  } catch (err) {
    throw toRedactedKernelError(err, `Failed to download Kernel file '${remotePath}'`, "KERNEL_FS_DOWNLOAD_FAILED");
  }
}

export async function executeKernelPlaywright(
  sessionId: string,
  code: string,
  options: KernelCreateOptions & { timeoutSec?: number } = {},
): Promise<KernelPlaywrightResult> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.playwright?.execute) throw new BrowserError("Kernel SDK does not expose Playwright execution", "KERNEL_PLAYWRIGHT_UNAVAILABLE", true);
  try {
    const result = await client.browsers.playwright.execute(sessionId, {
      code,
      timeout_sec: options.timeoutSec,
    });
    return {
      ...result,
      result: redactKernelResult(result.result),
      error: result.error ? redactKernelSensitiveText(result.error) : undefined,
      stderr: result.stderr ? redactKernelSensitiveText(result.stderr) : undefined,
      stdout: result.stdout ? redactKernelSensitiveText(result.stdout) : undefined,
    };
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to execute Playwright code in Kernel browser", "KERNEL_PLAYWRIGHT_FAILED");
  }
}

export async function captureKernelComputerScreenshotToDownloads(
  sessionId: string,
  options: KernelCreateOptions & {
    localSessionId?: string;
    region?: { x: number; y: number; width: number; height: number };
    filename?: string;
  } = {},
) {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.computer?.captureScreenshot) throw new BrowserError("Kernel SDK does not expose computer screenshot capture", "KERNEL_COMPUTER_UNAVAILABLE", true);
  try {
    const response = await client.browsers.computer.captureScreenshot(sessionId, options.region ? { region: options.region } : undefined);
    const buffer = Buffer.from(await response.arrayBuffer());
    return saveToDownloads(buffer, options.filename ?? `kernel-screenshot-${sessionId}.png`, {
      sessionId: options.localSessionId,
      type: "screenshot",
      sourceUrl: `kernel://${sessionId}/computer/screenshot`,
      metadata: { kernel_session_id: sessionId, region: options.region },
    });
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to capture Kernel computer screenshot", "KERNEL_COMPUTER_SCREENSHOT_FAILED");
  }
}

export async function runKernelComputerAction(
  sessionId: string,
  action: "click" | "move" | "type" | "press" | "scroll" | "batch",
  params: Record<string, unknown>,
  options: KernelCreateOptions = {},
): Promise<{ ok: true }> {
  const client = await createConfiguredKernelClient(options);
  const computer = client.browsers.computer;
  if (!computer) throw new BrowserError("Kernel SDK does not expose computer controls", "KERNEL_COMPUTER_UNAVAILABLE", true);
  try {
    if (action === "click" && computer.clickMouse) await computer.clickMouse(sessionId, params);
    else if (action === "move" && computer.moveMouse) await computer.moveMouse(sessionId, params);
    else if (action === "type" && computer.typeText) await computer.typeText(sessionId, params);
    else if (action === "press" && computer.pressKey) await computer.pressKey(sessionId, params);
    else if (action === "scroll" && computer.scroll) await computer.scroll(sessionId, params);
    else if (action === "batch" && computer.batch) await computer.batch(sessionId, { actions: params.actions as Array<Record<string, unknown>> });
    else throw new BrowserError(`Kernel computer action '${action}' is unavailable in this SDK`, "KERNEL_COMPUTER_ACTION_UNAVAILABLE", true);
    return { ok: true };
  } catch (err) {
    if (err instanceof BrowserError) throw err;
    throw toRedactedKernelError(err, `Failed to run Kernel computer action '${action}'`, "KERNEL_COMPUTER_ACTION_FAILED");
  }
}

export async function listKernelReplays(sessionId: string, options: KernelCreateOptions = {}): Promise<KernelReplayInfo[]> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.replays?.list) throw new BrowserError("Kernel SDK does not expose replay list", "KERNEL_REPLAY_UNAVAILABLE", true);
  try {
    return await client.browsers.replays.list(sessionId);
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to list Kernel replays", "KERNEL_REPLAY_LIST_FAILED");
  }
}

export async function startKernelReplay(
  sessionId: string,
  options: KernelCreateOptions & { framerate?: number; maxDurationSeconds?: number; recordAudio?: boolean } = {},
): Promise<KernelReplayInfo> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.replays?.start) throw new BrowserError("Kernel SDK does not expose replay start", "KERNEL_REPLAY_UNAVAILABLE", true);
  try {
    return await client.browsers.replays.start(sessionId, {
      framerate: options.framerate,
      max_duration_in_seconds: options.maxDurationSeconds,
      record_audio: options.recordAudio,
    });
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to start Kernel replay", "KERNEL_REPLAY_START_FAILED");
  }
}

export async function stopKernelReplay(sessionId: string, replayId: string, options: KernelCreateOptions = {}): Promise<{ stopped: string }> {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.replays?.stop) throw new BrowserError("Kernel SDK does not expose replay stop", "KERNEL_REPLAY_UNAVAILABLE", true);
  try {
    await client.browsers.replays.stop(replayId, { id: sessionId });
    return { stopped: replayId };
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to stop Kernel replay", "KERNEL_REPLAY_STOP_FAILED");
  }
}

export async function downloadKernelReplayToDownloads(
  sessionId: string,
  replayId: string,
  options: KernelCreateOptions & { localSessionId?: string; filename?: string } = {},
) {
  const client = await createConfiguredKernelClient(options);
  if (!client.browsers.replays?.download) throw new BrowserError("Kernel SDK does not expose replay download", "KERNEL_REPLAY_UNAVAILABLE", true);
  try {
    const response = await client.browsers.replays.download(replayId, { id: sessionId });
    const buffer = Buffer.from(await response.arrayBuffer());
    return saveToDownloads(buffer, options.filename ?? `kernel-replay-${replayId}.mp4`, {
      sessionId: options.localSessionId,
      type: "video",
      sourceUrl: `kernel://${sessionId}/replays/${replayId}`,
      metadata: { kernel_session_id: sessionId, replay_id: replayId },
    });
  } catch (err) {
    throw toRedactedKernelError(err, "Failed to download Kernel replay", "KERNEL_REPLAY_DOWNLOAD_FAILED");
  }
}

async function createConfiguredKernelClient(options: KernelCreateOptions = {}): Promise<KernelClientLike> {
  const secrets = await getSecretsProvider();
  const apiKey = options.apiKey?.trim() || await resolveKernelApiKey(secrets);
  return createKernelClient(apiKey, resolveKernelClientConfig(options));
}

async function ensureKernelProfile(client: KernelClientLike, profileName: string): Promise<void> {
  if (!client.profiles?.create) return;
  try {
    await client.profiles.create({ name: profileName });
  } catch (err) {
    if (!isConflictError(err)) throw toRedactedKernelError(err, `Failed to create Kernel profile '${profileName}'`, "KERNEL_PROFILE_CREATE_FAILED");
  }
}

async function listKernelBrowsersWithClient(
  client: KernelClientLike,
  options: { status?: string; limit?: number } = {},
): Promise<KernelBrowserCreateResponse[]> {
  if (!client.browsers.list) throw new BrowserError("Kernel SDK does not expose browser list", "KERNEL_LIST_UNAVAILABLE", true);
  const limit = options.limit ?? 25;
  const result = await client.browsers.list({ status: options.status, limit });
  const sessions: KernelBrowserCreateResponse[] = [];
  if (isAsyncIterable<KernelBrowserCreateResponse>(result)) {
    for await (const item of result) {
      sessions.push(item);
      if (sessions.length >= limit) break;
    }
    return sessions;
  }
  const payload = await result;
  return (payload.items ?? payload.data ?? []).slice(0, limit);
}

function sanitizeKernelBrowser(browser: KernelBrowserCreateResponse): Record<string, unknown> {
  return {
    session_id: browser.session_id,
    name: browser.name,
    status: browser.deleted_at ? "deleted" : "active",
    created_at: browser.created_at,
    deleted_at: browser.deleted_at,
    headless: browser.headless,
    stealth: browser.stealth,
    timeout_seconds: browser.timeout_seconds,
    start_url: browser.start_url,
    profile: browser.profile,
    persistence_id: browser.persistence_id ?? browser.profile?.id ?? browser.profile?.name ?? undefined,
    proxy_id: browser.proxy_id,
    gpu: browser.gpu,
    kiosk_mode: browser.kiosk_mode,
    tags: browser.tags,
    usage: browser.usage,
    telemetry: browser.telemetry,
    has_cdp_ws_url: Boolean(browser.cdp_ws_url),
    has_webdriver_ws_url: Boolean(browser.webdriver_ws_url),
    has_browser_live_view_url: Boolean(browser.browser_live_view_url),
    browser_live_view_url: browser.browser_live_view_url ? redactKernelSensitiveText(browser.browser_live_view_url) : undefined,
    base_url: browser.base_url ? redactKernelSensitiveText(browser.base_url) : undefined,
  };
}

function toRedactedKernelError(err: unknown, prefix: string, code: string): BrowserError {
  const message = err instanceof Error ? err.message : String(err);
  return new BrowserError(`${prefix}: ${redactKernelSensitiveText(message)}`, code, true);
}

export function redactKernelSensitiveText(message: string): string {
  let redacted = message
    .replace(/wss?:\/\/[^\s"')]+/gi, "[redacted-kernel-websocket-url]")
    .replace(/https?:\/\/[^\s"')]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        for (const key of [...parsed.searchParams.keys()]) {
          if (/jwt|token|key|secret|password|credential/i.test(key)) {
            parsed.searchParams.set(key, "[redacted]");
          }
        }
        return parsed.toString();
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(new RegExp("(" + kernelApiEnvName + "\\s*=\\s*)[^\\s\"'`]+", "gi"), "$1[redacted]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1[redacted]");

  const envKey = process.env[kernelApiEnvName]?.trim();
  if (envKey) redacted = redacted.split(envKey).join("[redacted-kernel-api-key]");
  return redacted;
}

function redactKernelResult<T>(value: T): T {
  if (typeof value === "string") return redactKernelCapabilityUrl(value) as T;
  if (Array.isArray(value)) return value.map(redactKernelResult) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactKernelResult(item);
  }
  return out as T;
}

export async function autofillLoginFromVault(
  page: Page,
  targetUrl: string,
  secrets?: KernelSecretsProvider,
): Promise<boolean> {
  const login = await findVaultLoginForUrl(targetUrl, secrets ?? await getSecretsProvider());
  if (!login) return false;

  const username = firstString(login.data, ["username", "email", "login"]);
  const password = firstString(login.data, ["password"]);
  if (!password) return false;

  let filled = false;
  if (username) {
    filled = await fillFirst(page, [
      "input[type='email']",
      "input[name*='email' i]",
      "input[name*='user' i]",
      "input[autocomplete='username']",
      "input[type='text']",
    ], username) || filled;
  }
  const passwordFilled = await fillFirst(page, [
    "input[type='password']",
    "input[autocomplete='current-password']",
    "input[name*='pass' i]",
  ], password);
  if (!passwordFilled) return filled;

  await submitLoginForm(page).catch(() => {});
  await scrubPasswordFields(page).catch(() => {});
  return true;
}

async function prepareKernelManagedAuth(
  client: KernelClientLike,
  targetUrl: string,
  opts: { persistenceId?: string; secrets: KernelSecretsProvider },
): Promise<{
  persistenceId?: string;
  authConnectionId?: string;
  authStatus?: string;
  authLiveViewUrl?: string;
  authFallback?: "cdp_autofill";
}> {
  const login = await findVaultLoginForUrl(targetUrl, opts.secrets);
  if (!login) return {};
  if (!client.credentials || !client.auth?.connections) {
    throw new BrowserError("Kernel SDK does not expose managed auth resources", "KERNEL_AUTH_UNAVAILABLE", true);
  }

  const domain = login.domains[0] ?? domainFromUrl(targetUrl);
  const username = firstString(login.data, ["username", "email", "login"]);
  const password = firstString(login.data, ["password"]);
  if (!domain || !password) return {};

  const profileName = sanitizeKernelName(opts.persistenceId ?? `open-browser-${domain}-${login.id}`);
  const credentialName = sanitizeKernelName(`open-browser-${domain}-${login.id}`);
  const values: Record<string, string> = { password };
  if (username) values.username = username;
  const totpSecret = firstString(login.data, ["totp_secret", "totp"]);

  try {
    await client.credentials.create({
      domain,
      name: credentialName,
      values,
      ...(totpSecret ? { totp_secret: totpSecret } : {}),
    });
  } catch (err) {
    if (!isConflictError(err) || !client.credentials.update) throw err;
    await client.credentials.update(credentialName, {
      values,
      ...(totpSecret ? { totp_secret: totpSecret } : {}),
    });
  }

  const connection = await getOrCreateManagedAuthConnection(client, {
    domain,
    profileName,
    credentialName,
    loginUrl: targetUrl,
  });
  let authStatus = connection.status;
  let authLiveViewUrl = connection.live_view_url ?? undefined;
  if (connection.status !== "AUTHENTICATED") {
    const loginResponse = await client.auth.connections.login(connection.id, { record_session: false });
    authLiveViewUrl = loginResponse.live_view_url ?? authLiveViewUrl;
    const polled = await pollManagedAuth(client, connection.id);
    authStatus = polled.status;
    authLiveViewUrl = polled.live_view_url ?? authLiveViewUrl;
  }

  return {
    persistenceId: profileName,
    authConnectionId: connection.id,
    authStatus,
    authLiveViewUrl,
  };
}

async function getOrCreateManagedAuthConnection(
  client: KernelClientLike,
  opts: { domain: string; profileName: string; credentialName: string; loginUrl: string },
): Promise<KernelManagedAuth> {
  const connections = client.auth?.connections;
  if (!connections) throw new BrowserError("Kernel managed auth connections are unavailable", "KERNEL_AUTH_UNAVAILABLE", true);
  try {
    return await connections.create({
      domain: opts.domain,
      profile_name: opts.profileName,
      credential: { name: opts.credentialName },
      login_url: opts.loginUrl,
      save_credentials: true,
      record_session: false,
    });
  } catch (err) {
    if (!isConflictError(err) || !connections.list) throw err;
    const existing = await firstManagedAuth(connections.list({ domain: opts.domain, profile_name: opts.profileName }));
    if (!existing) throw err;
    return existing;
  }
}

async function pollManagedAuth(client: KernelClientLike, id: string): Promise<KernelManagedAuth> {
  const retrieve = client.auth?.connections?.retrieve;
  if (!retrieve) throw new BrowserError("Kernel managed auth retrieve is unavailable", "KERNEL_AUTH_UNAVAILABLE", true);

  const deadline = Date.now() + 30_000;
  let latest = await retrieve(id);
  while (Date.now() < deadline) {
    if (latest.status === "AUTHENTICATED" || latest.flow_status === "SUCCESS") return latest;
    if (latest.flow_status === "FAILED" || latest.flow_status === "EXPIRED" || latest.flow_status === "CANCELED") {
      throw new BrowserError(
        `Kernel managed auth failed: ${latest.error_message ?? latest.flow_status}`,
        "KERNEL_AUTH_FAILED",
        true,
      );
    }
    await sleep(1_000);
    latest = await retrieve(id);
  }
  return latest;
}

async function firstManagedAuth(
  result: AsyncIterable<KernelManagedAuth> | Promise<{ items?: KernelManagedAuth[] }>,
): Promise<KernelManagedAuth | undefined> {
  const resolved = await result;
  if (isAsyncIterable<KernelManagedAuth>(resolved)) {
    for await (const item of resolved) return item;
    return undefined;
  }
  return resolved.items?.[0];
}

async function resolveKernelEnv(
  options: KernelCreateOptions,
  secrets: KernelSecretsProvider,
): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...(options.env ?? {}) };
  for (const [name, key] of Object.entries(options.envSecrets ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new BrowserError(`Invalid Kernel env var name '${name}'`, "KERNEL_ENV_INVALID", true);
    }
    const value = await secrets.getSecretValue(key);
    if (!value) throw new BrowserError(`Kernel env secret '${key}' was not found`, "KERNEL_ENV_SECRET_MISSING", true);
    env[name] = value;
  }
  return env;
}

async function findVaultLoginForUrl(url: string, secrets: KernelSecretsProvider): Promise<VaultItem | undefined> {
  const matches = await secrets.matchVaultItemsForUrl(url).catch(() => []);
  const metadata = matches.find((item) => item.kind === "login");
  if (!metadata) return undefined;
  const item = await secrets.getVaultItem(metadata.id).catch(() => undefined);
  return item?.kind === "login" ? item : undefined;
}

async function createDefaultSecretsProvider(): Promise<KernelSecretsProvider> {
  const programmatic = await createProgrammaticSecretsProvider();
  if (programmatic) return programmatic;
  return createCliSecretsProvider();
}

async function createProgrammaticSecretsProvider(): Promise<KernelSecretsProvider | undefined> {
  const moduleName = "@hasna/secrets/vault";
  try {
    const vault = await import(moduleName) as {
      getSecret?: (key: string) => { value?: string } | string | undefined;
      setSecret?: (key: string, value: string, type?: string, label?: string) => unknown;
      matchVaultItemsForUrl?: (url: string) => VaultItemMetadata[];
      getVaultItem?: (id: string) => VaultItem | undefined;
    };
    if (!vault.getSecret || !vault.matchVaultItemsForUrl || !vault.getVaultItem) return undefined;
    return {
      async getSecretValue(key) {
        const entry = await vault.getSecret?.(key);
        return typeof entry === "string" ? entry : entry?.value;
      },
      async setSecretValue(key, value, opts) {
        await vault.setSecret?.(key, value, opts?.type, opts?.label);
      },
      async matchVaultItemsForUrl(url) {
        return vault.matchVaultItemsForUrl?.(url) ?? [];
      },
      async getVaultItem(id) {
        return vault.getVaultItem?.(id);
      },
    };
  } catch {
    return undefined;
  }
}

function createCliSecretsProvider(): KernelSecretsProvider {
  return {
    async getSecretValue(key) {
      return execSecrets(["get", key]).then((value) => value || undefined).catch(() => undefined);
    },
    async matchVaultItemsForUrl(url) {
      const output = await execSecrets(["items", "list", "login"]).catch(() => "");
      const ids = output
        .split(/\r?\n/)
        .map((line) => line.match(/^(\S+)\s+\[login\]/)?.[1])
        .filter((id): id is string => Boolean(id));
      const items = await Promise.all(ids.map((id) => this.getVaultItem(id)));
      return items
        .filter((item): item is VaultItem => Boolean(item))
        .filter((item) => vaultItemMatchesUrl(item, url))
        .map(({ data: _data, ...metadata }) => metadata);
    },
    async getVaultItem(id) {
      const output = await execSecrets(["items", "get", id, "--show"]).catch(() => "");
      if (!output) return undefined;
      try {
        return JSON.parse(output) as VaultItem;
      } catch {
        return undefined;
      }
    },
  };
}

async function execSecrets(args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile("secrets", args, { maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function vaultItemMatchesUrl(item: VaultItemMetadata, rawUrl: string): boolean {
  const hostname = normalizeDomain(rawUrl);
  if (!hostname) return false;
  if (item.domains?.length) return item.domains.some((domain) => domainMatches(hostname, domain));
  const terms = hostSearchTerms(hostname);
  const haystack = [item.title, item.subtitle, ...(item.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  try {
    const withScheme = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
  }
}

function domainMatches(hostname: string, domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return Boolean(normalized) && (hostname === normalized || hostname.endsWith(`.${normalized}`));
}

function hostSearchTerms(hostname: string): string[] {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 1) return [hostname];
  return [...new Set([hostname, parts.slice(-2).join("."), parts[0]])].filter(Boolean);
}

function domainFromUrl(url: string): string | undefined {
  const domain = normalizeDomain(url);
  return domain || undefined;
}

function firstString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function sanitizeKernelName(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (sanitized || "open-browser").slice(0, 255);
}

function isConflictError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const maybe = err as { status?: number; name?: string; message?: string };
  return maybe.status === 409 || maybe.name === "ConflictError" || /conflict|already exists/i.test(maybe.message ?? "");
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return Boolean(value && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function");
}

async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().fill(value, { timeout: 1_000 });
      return true;
    } catch {}
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactKernelCapabilityUrl(message: string): string {
  return message
    .replace(/wss?:\/\/\S+/gi, "[redacted-cdp-url]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

async function submitLoginForm(page: Page): Promise<void> {
  const passwordInput = page.locator("input[type='password']").first();
  await passwordInput.waitFor({ timeout: 1_000 }).catch(() => {});
  const submitted = await passwordInput.evaluate((input) => {
    const element = input as HTMLInputElement;
    const form = element.form;
    if (form && typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return true;
    }
    return false;
  }).catch(() => false);

  if (!submitted) {
    await page.keyboard.press("Enter").catch(() => {});
  }

  await Promise.race([
    page.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => undefined),
    page.waitForTimeout(750).catch(() => undefined),
  ]);
}

async function scrubPasswordFields(page: Page): Promise<void> {
  await page.locator("input[type='password']").evaluateAll((inputs) => {
    for (const input of inputs) {
      const element = input as HTMLInputElement;
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}
