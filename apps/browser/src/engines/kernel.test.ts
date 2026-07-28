import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Browser } from "playwright";
import {
  captureKernelComputerScreenshotToDownloads,
  closeKernelSandbox,
  connectKernelBrowser,
  createKernelSandbox,
  deleteKernelBrowser,
  downloadKernelFileToDownloads,
  downloadKernelReplayToDownloads,
  executeKernelPlaywright,
  getKernelStatus,
  listKernelBrowsers,
  listKernelFiles,
  listKernelReplays,
  redactKernelSensitiveText,
  resolveKernelApiKey,
  runKernelComputerAction,
  setKernelCdpConnectorForTests,
  setKernelClientFactoryForTests,
  setKernelSecretsProviderForTests,
  startKernelReplay,
  stopKernelReplay,
  type KernelSecretsProvider,
} from "./kernel.js";
import { BrowserError } from "../types/index.js";

function secretsProvider(overrides: Partial<KernelSecretsProvider> = {}): KernelSecretsProvider {
  return {
    async getSecretValue(key) {
      if (key === "hasna/xyz/opensource/browser/prod/kernel_api_key") return "kernel-test-key";
      if (key === "apps/example/prod/token") return "sandbox-token";
      return undefined;
    },
    async matchVaultItemsForUrl(url) {
      return url.includes("example.com")
        ? [{ id: "login-1", kind: "login", title: "Example", domains: ["example.com"], tags: [] }]
        : [];
    },
    async getVaultItem(id) {
      if (id !== "login-1") return undefined;
      return {
        id,
        kind: "login",
        title: "Example",
        domains: ["example.com"],
        tags: [],
        data: {
          username: "user@example.com",
          password: "super-secret-password",
          totp_secret: "ABC123",
        },
      };
    },
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "browser-kernel-test-"));
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "browser.db");
});

afterEach(() => {
  setKernelClientFactoryForTests(undefined);
  setKernelSecretsProviderForTests(undefined);
  setKernelCdpConnectorForTests(undefined);
  delete process.env["BROWSER_DATA_DIR"];
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_ALLOW_STEALTH"];
  delete process.env["KERNEL_API_KEY"];
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("kernel engine", () => {
  it("creates a Kernel browser with vault-resolved env and reusable profile metadata", async () => {
    const createCalls: unknown[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests((apiKey) => ({
      browsers: {
        async create(params) {
          createCalls.push({ apiKey, params });
          return {
            session_id: "kernel-session-1",
            cdp_ws_url: "wss://kernel.test/cdp",
            webdriver_ws_url: "wss://kernel.test/webdriver",
            browser_live_view_url: "https://kernel.test/live",
          };
        },
        async deleteByID() {},
      },
    }));

    const sandbox = await createKernelSandbox({
      startUrl: "https://example.test",
      persistenceId: "persisted-profile",
      envSecrets: { EXAMPLE_TOKEN: "apps/example/prod/token" },
      authMode: "off",
    });

    expect(sandbox.metadata).toMatchObject({
      sessionId: "kernel-session-1",
      cdpWsUrl: "wss://kernel.test/cdp",
      browserLiveViewUrl: "https://kernel.test/live",
      persistenceId: "persisted-profile",
    });
    expect(createCalls).toEqual([{
      apiKey: "kernel-test-key",
      params: {
        headless: true,
        start_url: "https://example.test",
        name: undefined,
        timeout_seconds: undefined,
        viewport: undefined,
        profile: { name: "persisted-profile", save_changes: true },
        env: { EXAMPLE_TOKEN: "sandbox-token" },
      },
    }]);
  });

  it("attaches to Kernel cdp_ws_url and deletes the Kernel session on close", async () => {
    const deletes: string[] = [];
    const attached: string[] = [];
    const connectOptions: Array<{ timeoutMs?: number } | undefined> = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-session-2", cdp_ws_url: "wss://kernel.test/cdp-2" };
        },
        async list() {
          return {
            items: [{
              session_id: "kernel-close-2",
              cdp_ws_url: "wss://kernel.test/cdp-2",
            }],
          };
        },
        async deleteByID(id) {
          deletes.push(id);
        },
      },
    }));
    setKernelCdpConnectorForTests(async (cdpUrl, options) => {
      attached.push(cdpUrl);
      connectOptions.push(options);
      return {} as Browser;
    });

    const connected = await connectKernelBrowser({ authMode: "off" });
    expect(attached).toEqual(["wss://kernel.test/cdp-2"]);
    expect(connectOptions).toEqual([{ timeoutMs: 120_000 }]);

    await connected.close();
    expect(deletes).toEqual(["kernel-close-2"]);
  });

  it("retries close_id discovery when a new Kernel browser is not immediately listed", async () => {
    const deletes: string[] = [];
    let listCalls = 0;
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-exec-retry", cdp_ws_url: "wss://kernel.test/cdp-retry" };
        },
        async list() {
          listCalls += 1;
          return {
            items: listCalls < 3
              ? []
              : [{ session_id: "kernel-close-retry", cdp_ws_url: "wss://kernel.test/cdp-retry" }],
          };
        },
        async deleteByID(id) {
          deletes.push(id);
        },
      },
    }));

    const sandbox = await createKernelSandbox({ authMode: "off" });
    await closeKernelSandbox(sandbox);

    expect(listCalls).toBe(3);
    expect(deletes).toEqual(["kernel-close-retry"]);
  });

  it("does not use exec_id for cleanup when close_id cannot be resolved", async () => {
    const deletes: string[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-exec-missing", cdp_ws_url: "wss://kernel.test/cdp-missing" };
        },
        async list() {
          return { items: [] };
        },
        async deleteByID(id) {
          deletes.push(id);
        },
      },
    }));

    const sandbox = await createKernelSandbox({ authMode: "off" });
    expect(closeKernelSandbox(sandbox)).rejects.toMatchObject({
      code: "KERNEL_CLOSE_ID_NOT_FOUND",
    });
    expect(deletes).toEqual([]);
  });

  it("passes explicit Kernel request timeout to CDP attach", async () => {
    const connectOptions: Array<{ timeoutMs?: number } | undefined> = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-session-timeout", cdp_ws_url: "wss://kernel.test/cdp-timeout" };
        },
        async deleteByID() {},
      },
    }));
    setKernelCdpConnectorForTests(async (_cdpUrl, options) => {
      connectOptions.push(options);
      return {} as Browser;
    });

    await connectKernelBrowser({ authMode: "off", requestTimeoutMs: 180_000 });
    expect(connectOptions).toEqual([{ timeoutMs: 180_000 }]);
  });

  it("redacts Kernel CDP URLs from attach errors", async () => {
    const deletes: string[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-session-redact", cdp_ws_url: "wss://secret.kernel.test/devtools/browser/token" };
        },
        async list() {
          return {
            items: [{
              session_id: "kernel-close-redact",
              cdp_ws_url: "wss://secret.kernel.test/devtools/browser/token",
            }],
          };
        },
        async deleteByID(id) {
          deletes.push(id);
        },
      },
    }));
    setKernelCdpConnectorForTests(async () => {
      throw new Error("Failed to connect to wss://secret.kernel.test/devtools/browser/token");
    });

    let message = "";
    try {
      await connectKernelBrowser({ authMode: "off" });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("[redacted-kernel-websocket-url]");
    expect(message).not.toContain("secret.kernel.test");
    expect(deletes).toEqual(["kernel-close-redact"]);
  });

  it("uses Kernel managed auth without returning vault passwords in metadata", async () => {
    const credentialCreates: unknown[] = [];
    const connectionCreates: unknown[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create(params) {
          return {
            session_id: "kernel-session-3",
            cdp_ws_url: "wss://kernel.test/cdp-3",
            profile: (params?.profile as { name?: string }) ?? undefined,
          };
        },
        async deleteByID() {},
      },
      credentials: {
        async create(params) {
          credentialCreates.push(params);
        },
      },
      auth: {
        connections: {
          async create(params) {
            connectionCreates.push(params);
            return {
              id: "auth-1",
              domain: "example.com",
              profile_name: params.profile_name,
              status: "NEEDS_AUTH" as const,
            };
          },
          async login() {
            return { id: "auth-1", live_view_url: "https://kernel.test/auth-live" };
          },
          async retrieve() {
            return {
              id: "auth-1",
              domain: "example.com",
              profile_name: "open-browser-example.com-login-1",
              status: "AUTHENTICATED" as const,
              flow_status: "SUCCESS" as const,
            };
          },
        },
      },
    }));

    const sandbox = await createKernelSandbox({ startUrl: "https://example.com/login" });

    expect(credentialCreates).toEqual([{
      domain: "example.com",
      name: "open-browser-example.com-login-1",
      values: { username: "user@example.com", password: "super-secret-password" },
      totp_secret: "ABC123",
    }]);
    expect(connectionCreates).toEqual([{
      domain: "example.com",
      profile_name: "open-browser-example.com-login-1",
      credential: { name: "open-browser-example.com-login-1" },
      login_url: "https://example.com/login",
      save_credentials: true,
      record_session: false,
    }]);
    expect(JSON.stringify(sandbox.metadata)).not.toContain("super-secret-password");
    expect(sandbox.metadata.authConnectionId).toBe("auth-1");
    expect(sandbox.metadata.authStatus).toBe("AUTHENTICATED");
    expect(sandbox.metadata.authLiveViewUrl).toBe("https://kernel.test/auth-live");
  });

  it("creates named profiles before launching browsers and passes current Kernel options", async () => {
    const profileCreates: unknown[] = [];
    const createCalls: unknown[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    process.env["BROWSER_ALLOW_STEALTH"] = "1";
    setKernelClientFactoryForTests(() => ({
      profiles: {
        async create(params) {
          profileCreates.push(params);
        },
      },
      browsers: {
        async create(params) {
          createCalls.push(params);
          return {
            session_id: "kernel-session-options",
            cdp_ws_url: "wss://kernel.test/cdp-options?jwt=secret",
            webdriver_ws_url: "wss://kernel.test/webdriver-options?jwt=secret",
            browser_live_view_url: "https://kernel.test/live?jwt=secret",
            base_url: "https://kernel.test/browser/kernel",
            profile: { id: "profile-id", name: "profile-a" },
            headless: false,
            stealth: true,
            timeout_seconds: 90,
            gpu: true,
            kiosk_mode: true,
            proxy_id: "proxy-1",
          };
        },
        async deleteByID() {},
      },
    }));

    const sandbox = await createKernelSandbox({
      startUrl: "https://example.test",
      profileName: "profile-a",
      saveProfileChanges: false,
      headless: false,
      stealth: true,
      timeoutSeconds: 90,
      proxyId: "proxy-1",
      gpu: true,
      kioskMode: true,
      tags: { team: "browser" },
      telemetry: true,
      chromePolicy: { DownloadRestrictions: 0 },
      authMode: "off",
      approvalToken: process.env["BROWSER_CAPABILITY_TOKEN"],
    });

    expect(profileCreates).toEqual([{ name: "profile-a" }]);
    expect(createCalls).toEqual([{
      headless: false,
      start_url: "https://example.test",
      name: undefined,
      timeout_seconds: 90,
      viewport: undefined,
      chrome_policy: { DownloadRestrictions: 0 },
      gpu: true,
      kiosk_mode: true,
      stealth: true,
      proxy_id: "proxy-1",
      tags: { team: "browser" },
      telemetry: true,
      profile: { name: "profile-a", save_changes: false },
    }]);
    expect(sandbox.metadata).toMatchObject({
      sessionId: "kernel-session-options",
      baseUrl: "https://kernel.test/browser/kernel",
      persistenceId: "profile-a",
      proxyId: "proxy-1",
      gpu: true,
      kioskMode: true,
    });
  });

  it("reports Kernel status without exposing the API key", async () => {
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          throw new Error("not used");
        },
        async deleteByID() {},
        async list() {
          return { items: [{ session_id: "remote-1", cdp_ws_url: "wss://kernel.test/cdp?jwt=secret" }] };
        },
      },
    }));

    const status = await getKernelStatus({ checkRemote: true });
    expect(status.configured).toBe(true);
    expect(status.apiKeySource).toBe("vault");
    expect(status.remote).toEqual({ ok: true, activeSessions: 1 });
    expect(JSON.stringify(status)).not.toContain("kernel-test-key");
  });

  it("lists Kernel sessions with capability URLs redacted", async () => {
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          throw new Error("not used");
        },
        async deleteByID() {},
        async list() {
          return {
            items: [{
              session_id: "remote-1",
              cdp_ws_url: "wss://kernel.test/cdp?jwt=secret",
              webdriver_ws_url: "wss://kernel.test/webdriver?jwt=secret",
              browser_live_view_url: "https://kernel.test/live?jwt=secret",
              base_url: "https://kernel.test/browser/kernel?jwt=secret",
              name: "remote-browser",
            }],
          };
        },
      },
    }));

    const sessions = await listKernelBrowsers();
    const serialized = JSON.stringify(sessions);
    expect(serialized).not.toContain("cdp?jwt=secret");
    expect(serialized).toContain("has_cdp_ws_url");
    expect(serialized).toContain("jwt=%5Bredacted%5D");
  });

  it("labels create and list identifiers by the operations that accept them", async () => {
    const deleted: string[] = [];
    const executed: string[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return {
            session_id: "kernel-exec-id",
            cdp_ws_url: "wss://kernel.test/cdp",
          };
        },
        async deleteByID(id) {
          deleted.push(id);
        },
        async list() {
          return {
            items: [{
              session_id: "kernel-close-id",
              cdp_ws_url: "wss://kernel.test/cdp",
            }],
          };
        },
        playwright: {
          async execute(id) {
            executed.push(id);
            return { success: true };
          },
        },
      },
    }));

    const sandbox = await createKernelSandbox({ authMode: "off" });
    const sessions = await listKernelBrowsers();
    const execution = await executeKernelPlaywright("kernel-exec-id", "return true;");
    const close = await deleteKernelBrowser("kernel-exec-id");

    expect(sandbox.metadata).toMatchObject({
      sessionId: "kernel-exec-id",
      execId: "kernel-exec-id",
    });
    expect(sessions[0]).toMatchObject({
      session_id: "kernel-close-id",
      close_id: "kernel-close-id",
    });
    expect(execution).toMatchObject({ success: true, exec_id: "kernel-exec-id" });
    expect(close).toEqual({ deleted: "kernel-close-id", close_id: "kernel-close-id" });
    expect(executed).toEqual(["kernel-exec-id"]);
    expect(deleted).toEqual(["kernel-close-id"]);
  });

  it("downloads Kernel filesystem files and computer screenshots into downloads", async () => {
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          throw new Error("not used");
        },
        async deleteByID() {},
        fs: {
          async listFiles() {
            return [{ name: "report.txt", path: "/tmp/report.txt", is_dir: false, mode: "-rw-r--r--", mod_time: "now", size_bytes: 5 }];
          },
          async fileInfo() {
            return { name: "report.txt", path: "/tmp/report.txt", is_dir: false, mode: "-rw-r--r--", mod_time: "now", size_bytes: 5 };
          },
          async readFile() {
            return new Response("hello");
          },
        },
        computer: {
          async captureScreenshot() {
            return new Response(new Uint8Array([1, 2, 3]));
          },
        },
      },
    }));

    expect(await listKernelFiles("remote-1", "/tmp")).toHaveLength(1);
    const file = await downloadKernelFileToDownloads("remote-1", "/tmp/report.txt", { localSessionId: "local-1" });
    const screenshot = await captureKernelComputerScreenshotToDownloads("remote-1", { localSessionId: "local-1" });

    expect(file.filename).toContain("report");
    expect(file.session_id).toBe("local-1");
    expect(screenshot.type).toBe("screenshot");
  });

  it("executes Kernel Playwright, computer actions, and replay lifecycle helpers", async () => {
    const actions: unknown[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          throw new Error("not used");
        },
        async deleteByID() {},
        playwright: {
          async execute(_id, body) {
            return { success: true, result: body.code.includes("title") ? "Example" : null, stdout: "ok" };
          },
        },
        computer: {
          async clickMouse(_id, body) {
            actions.push(body);
          },
        },
        replays: {
          async list() {
            return [{ replay_id: "replay-1", replay_view_url: "https://kernel.test/replay" }];
          },
          async start() {
            return { replay_id: "replay-2", replay_view_url: "https://kernel.test/replay-2" };
          },
          async stop() {},
          async download() {
            return new Response(new Uint8Array([1, 2, 3, 4]));
          },
        },
      },
    }));

    expect(await executeKernelPlaywright("remote-1", "return await page.title();")).toMatchObject({ success: true, result: "Example" });
    expect(await runKernelComputerAction("remote-1", "click", { x: 1, y: 2 })).toEqual({ ok: true });
    expect(actions).toEqual([{ x: 1, y: 2 }]);
    expect(await listKernelReplays("remote-1")).toHaveLength(1);
    expect(await startKernelReplay("remote-1")).toMatchObject({ replay_id: "replay-2" });
    expect(await stopKernelReplay("remote-1", "replay-2")).toEqual({ stopped: "replay-2" });
    const replay = await downloadKernelReplayToDownloads("remote-1", "replay-2");
    expect(replay.type).toBe("video");
  });

  it("redacts capability URLs from nested Kernel Playwright results", async () => {
    const calls: unknown[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          throw new Error("not used");
        },
        async deleteByID() {},
        playwright: {
          async execute(sessionId, params) {
            calls.push({ sessionId, params });
            return {
              success: true,
              result: {
                url: "wss://kernel.test/devtools/browser/secret-token",
                nested: ["https://kernel.test/live/secret-token"],
              },
            };
          },
        },
      },
    }));

    const result = await executeKernelPlaywright("kernel-session-4", "return await page.title()", {
      timeoutSec: 12,
    });

    expect(calls).toEqual([{
      sessionId: "kernel-session-4",
      params: { code: "return await page.title()", timeout_sec: 12 },
    }]);
    expect(JSON.stringify(result)).toContain("[redacted-cdp-url]");
    expect(JSON.stringify(result)).toContain("[redacted-url]");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("redacts Kernel secrets from error strings", () => {
    const envAssignment = "KERNEL_API_KEY" + "=secret";
    const redacted = redactKernelSensitiveText(`Bearer abc123 failed for wss://kernel.test/cdp?jwt=secret and ${envAssignment}`);
    expect(redacted).toContain("Bearer [redacted]");
    expect(redacted).toContain("[redacted-kernel-websocket-url]");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("jwt=secret");
    expect(redacted).not.toContain(envAssignment);
  });

  it("surfaces a transient vault read failure as a retryable error, not a missing key", async () => {
    delete process.env["KERNEL_API_KEY"];
    let calls = 0;
    setKernelSecretsProviderForTests(secretsProvider({
      async getSecretValue() {
        calls += 1;
        throw new Error("vault temporarily unavailable");
      },
    }));

    let caught: unknown;
    try {
      await resolveKernelApiKey();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BrowserError);
    expect((caught as BrowserError).code).toBe("KERNEL_API_KEY_READ_FAILED");
    expect((caught as BrowserError).retryable).toBe(true);
    // Retried the transient failure before giving up.
    expect(calls).toBe(3);
  });

  it("recovers when a transient vault read failure resolves on retry", async () => {
    delete process.env["KERNEL_API_KEY"];
    let calls = 0;
    setKernelSecretsProviderForTests(secretsProvider({
      async getSecretValue(key) {
        calls += 1;
        if (calls === 1) throw new Error("vault temporarily unavailable");
        if (key === "hasna/xyz/opensource/browser/prod/kernel_api_key") return "kernel-test-key";
        return undefined;
      },
    }));

    const key = await resolveKernelApiKey();
    expect(key).toBe("kernel-test-key");
    expect(calls).toBe(2);
  });

  it("reports a genuinely missing key without retrying the vault", async () => {
    delete process.env["KERNEL_API_KEY"];
    let calls = 0;
    setKernelSecretsProviderForTests(secretsProvider({
      async getSecretValue() {
        calls += 1;
        return undefined;
      },
    }));

    let caught: unknown;
    try {
      await resolveKernelApiKey();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BrowserError);
    expect((caught as BrowserError).code).toBe("KERNEL_API_KEY_MISSING");
    // A genuine absence is not retried.
    expect(calls).toBe(1);
  });

  it("uses an explicit env key when the vault read fails transiently", async () => {
    process.env["KERNEL_API_KEY"] = "env-kernel-key";
    setKernelSecretsProviderForTests(secretsProvider({
      async getSecretValue() {
        throw new Error("vault temporarily unavailable");
      },
    }));

    const key = await resolveKernelApiKey();
    expect(key).toBe("env-kernel-key");
  });
});
