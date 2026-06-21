import type { Browser, Page } from "playwright";
import { BrowserError } from "../types/index.js";
import { assertBrowserCapability } from "../lib/policy.js";
import { connectToExistingBrowser } from "./cdp.js";

export const KERNEL_API_KEY_SECRET_KEY = "hasna/xyz/opensource/browser/prod/kernel_api_key";

export type KernelAuthMode = "managed" | "cdp_autofill" | "auto" | "off";

export interface KernelCreateOptions {
  apiKey?: string;
  startUrl?: string;
  name?: string;
  headless?: boolean;
  stealth?: boolean;
  viewport?: { width: number; height: number };
  timeoutSeconds?: number;
  persistenceId?: string;
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
  persistenceId?: string;
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
  headless?: boolean;
  name?: string;
  profile?: { id?: string; name?: string; save_changes?: boolean };
  start_url?: string;
  stealth?: boolean;
  timeout_seconds?: number;
  viewport?: { width: number; height: number };
  [key: string]: unknown;
};

type KernelBrowserCreateResponse = {
  cdp_ws_url: string;
  session_id: string;
  webdriver_ws_url?: string;
  browser_live_view_url?: string;
  persistence_id?: string;
  profile?: { id?: string; name?: string | null };
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
    deleteByID(idOrName: string): Promise<void>;
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

type KernelClientFactory = (apiKey: string) => KernelClientLike | Promise<KernelClientLike>;
type KernelCdpConnector = (cdpUrl: string) => Promise<Browser>;

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

async function createKernelClient(apiKey: string): Promise<KernelClientLike> {
  if (kernelClientFactoryOverride) return kernelClientFactoryOverride(apiKey);
  const moduleName = "@onkernel/sdk";
  const mod = await import(moduleName);
  const Kernel = (mod as { default?: new (opts: { apiKey: string }) => KernelClientLike; Kernel?: new (opts: { apiKey: string }) => KernelClientLike }).default
    ?? (mod as { Kernel?: new (opts: { apiKey: string }) => KernelClientLike }).Kernel;
  if (!Kernel) throw new BrowserError("@onkernel/sdk did not export Kernel", "KERNEL_SDK_INVALID", true);
  return new Kernel({ apiKey });
}

async function getSecretsProvider(): Promise<KernelSecretsProvider> {
  if (secretsProviderOverride) return secretsProviderOverride;
  if (cachedSecretsProvider) return cachedSecretsProvider;
  cachedSecretsProvider = await createDefaultSecretsProvider();
  return cachedSecretsProvider;
}

export async function resolveKernelApiKey(secrets?: KernelSecretsProvider): Promise<string> {
  const provider = secrets ?? await getSecretsProvider();
  const vaultValue = (await provider.getSecretValue(KERNEL_API_KEY_SECRET_KEY).catch(() => undefined))?.trim();
  if (vaultValue) return vaultValue;

  const envValue = process.env["KERNEL_API_KEY"]?.trim();
  if (envValue) {
    await provider.setSecretValue?.(KERNEL_API_KEY_SECRET_KEY, envValue, {
      type: "api_key",
      label: "Kernel API key for @hasna/browser",
    }).catch(() => {});
    return envValue;
  }

  throw new BrowserError(
    `Kernel API key not found. Store it in @hasna/secrets at '${KERNEL_API_KEY_SECRET_KEY}' or set KERNEL_API_KEY for this process.`,
    "KERNEL_API_KEY_MISSING",
    true,
  );
}

export async function createKernelSandbox(options: KernelCreateOptions = {}): Promise<KernelSandbox> {
  if (options.stealth) {
    assertBrowserCapability("stealth", { approvalToken: options.approvalToken });
  }

  const secrets = await getSecretsProvider();
  const apiKey = options.apiKey?.trim() || await resolveKernelApiKey(secrets);
  const client = await createKernelClient(apiKey);
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
  if (options.stealth) createParams.stealth = true;
  if (persistenceId) createParams.profile = { name: persistenceId, save_changes: true };
  if (Object.keys(env).length > 0) createParams.env = env;

  const browser = await client.browsers.create(createParams);
  return {
    client,
    metadata: {
      sessionId: browser.session_id,
      cdpWsUrl: browser.cdp_ws_url,
      webdriverWsUrl: browser.webdriver_ws_url,
      browserLiveViewUrl: browser.browser_live_view_url,
      persistenceId: browser.persistence_id ?? persistenceId ?? browser.profile?.id ?? browser.profile?.name ?? undefined,
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

export async function connectKernelBrowser(options: KernelCreateOptions = {}): Promise<KernelConnectedBrowser> {
  const sandbox = await createKernelSandbox(options);
  const connector = cdpConnectorOverride ?? connectToExistingBrowser;
  try {
    const browser = await connector(sandbox.metadata.cdpWsUrl);
    return {
      browser,
      metadata: sandbox.metadata,
      close: () => closeKernelSandbox(sandbox),
    };
  } catch (err) {
    await closeKernelSandbox(sandbox).catch(() => {});
    throw new BrowserError(
      `Failed to connect to Kernel browser via CDP: ${err instanceof Error ? redactKernelCapabilityUrl(err.message) : "unknown error"}`,
      "KERNEL_CDP_CONNECT_FAILED",
      true,
    );
  }
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
