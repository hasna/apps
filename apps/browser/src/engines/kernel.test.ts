import { afterEach, describe, expect, it } from "bun:test";
import type { Browser } from "playwright";
import {
  connectKernelBrowser,
  createKernelSandbox,
  executeKernelPlaywright,
  setKernelCdpConnectorForTests,
  setKernelClientFactoryForTests,
  setKernelSecretsProviderForTests,
  type KernelSecretsProvider,
} from "./kernel.js";

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

afterEach(() => {
  setKernelClientFactoryForTests(undefined);
  setKernelSecretsProviderForTests(undefined);
  setKernelCdpConnectorForTests(undefined);
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
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-session-2", cdp_ws_url: "wss://kernel.test/cdp-2" };
        },
        async deleteByID(id) {
          deletes.push(id);
        },
      },
    }));
    setKernelCdpConnectorForTests(async (cdpUrl) => {
      attached.push(cdpUrl);
      return {} as Browser;
    });

    const connected = await connectKernelBrowser({ authMode: "off" });
    expect(attached).toEqual(["wss://kernel.test/cdp-2"]);

    await connected.close();
    expect(deletes).toEqual(["kernel-session-2"]);
  });

  it("redacts Kernel CDP URLs from attach errors", async () => {
    const deletes: string[] = [];
    setKernelSecretsProviderForTests(secretsProvider());
    setKernelClientFactoryForTests(() => ({
      browsers: {
        async create() {
          return { session_id: "kernel-session-redact", cdp_ws_url: "wss://secret.kernel.test/devtools/browser/token" };
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
    expect(message).toContain("[redacted-cdp-url]");
    expect(message).not.toContain("secret.kernel.test");
    expect(deletes).toEqual(["kernel-session-redact"]);
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

  it("executes Playwright code through Kernel SDK and redacts capability URLs", async () => {
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
});
