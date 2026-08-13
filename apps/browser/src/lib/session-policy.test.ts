import { afterEach, describe, expect, it } from "bun:test";
import { createSession } from "./session.js";
import {
  BROWSER_ALLOWED_DOMAINS_ENV,
  BROWSER_ALLOW_RISKY_CAPABILITIES_ENV,
  BROWSER_CAPABILITY_TOKEN_ENV,
} from "./policy.js";

const ENV_KEYS = [
  BROWSER_ALLOWED_DOMAINS_ENV,
  BROWSER_ALLOW_RISKY_CAPABILITIES_ENV,
  BROWSER_CAPABILITY_TOKEN_ENV,
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("session capability policy", () => {
  it("denies CDP attach before connecting to an existing browser", async () => {
    await expect(createSession({ cdpUrl: "http://127.0.0.1:9222" })).rejects.toThrow(/cdp_attach/);
  });

  it("denies TUI launch before spawning ttyd", async () => {
    await expect(createSession({ engine: "tui", startUrl: "bash" })).rejects.toThrow(/tui_launch/);
  });

  it("denies extension real-session automation before creating a session", async () => {
    await expect(createSession({ engine: "extension" })).rejects.toThrow(/extension_session/);
  });

  it("denies storage-state reuse before launching Playwright", async () => {
    await expect(createSession({ engine: "playwright", storageState: "saved-login" })).rejects.toThrow(/storage_state/);
  });

  it("denies non-allowlisted start URLs before launching Playwright", async () => {
    process.env[BROWSER_ALLOWED_DOMAINS_ENV] = "example.test";

    await expect(createSession({ engine: "playwright", startUrl: "https://evil.test" })).rejects.toThrow(/not in BROWSER_ALLOWED_DOMAINS/);
  });
});
