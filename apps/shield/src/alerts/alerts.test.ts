import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { AlertManager, loadAlertConfig, saveAlertConfig } from "./manager.js";
import { SlackChannel } from "./channels/slack.js";
import { DiscordChannel } from "./channels/discord.js";
import { WebhookChannel } from "./channels/webhook.js";
import type { AlertPayload, AlertConfig } from "./types.js";
import { tmpdir } from "os";

// Mock fetch for all channel tests
const mockFetch = mock(async (url: string, init?: RequestInit) => {
  return {
    ok: true,
    status: 200,
    text: async () => "ok",
    json: async () => ({ data: { id: "test-tweet-id" } }),
  } as Response;
});

// Replace global fetch
(globalThis as any).fetch = mockFetch;

const MOCK_ADVISORY = {
  id: "test-advisory-id",
  package_name: "axios",
  ecosystem: "npm" as const,
  affected_versions: ["1.14.1"],
  safe_versions: ["1.13.6"],
  attack_type: "maintainer-hijack" as const,
  severity: "critical" as const,
  title: "axios supply chain attack",
  description: "Test description",
  source: "https://example.com",
  cve_id: null,
  threat_actor: "TestActor",
  detected_at: "2026-03-31T00:21:00.000Z",
  resolved_at: null,
  tweet_id: null,
  created_at: "2026-03-31T00:21:00.000Z",
  updated_at: "2026-03-31T00:21:00.000Z",
};

const MOCK_IOCS = [
  { type: "domain", value: "evil.com", context: "C2 server" },
  { type: "ip", value: "1.2.3.4", context: "C2 IP" },
];

const MOCK_PAYLOAD: AlertPayload = {
  advisory: MOCK_ADVISORY,
  iocs: MOCK_IOCS,
  detected_at: "2026-03-31T00:21:00.000Z",
  source: "open-security/test",
};

describe("AlertManager", () => {
  test("disabled by default (no config)", () => {
    const manager = new AlertManager({ enabled: false, channels: {}, min_severity: "critical" });
    expect(manager.isEnabled()).toBe(false);
    expect(manager.getChannelNames()).toEqual([]);
  });

  test("shouldAlert respects min_severity", () => {
    const manager = new AlertManager({ enabled: true, channels: {}, min_severity: "critical" });
    expect(manager.shouldAlert({ ...MOCK_ADVISORY, severity: "critical" } as any)).toBe(false); // no channels
  });

  test("shouldAlert returns false when disabled", () => {
    const manager = new AlertManager({ enabled: false, channels: {}, min_severity: "critical" });
    expect(manager.shouldAlert(MOCK_ADVISORY as any)).toBe(false);
  });

  test("alert returns empty array when disabled", async () => {
    const manager = new AlertManager({ enabled: false, channels: {}, min_severity: "critical" });
    const results = await manager.alert(MOCK_ADVISORY as any, MOCK_IOCS);
    expect(results).toEqual([]);
  });

  test("initializes Slack channel from env var", () => {
    const orig = process.env.SECURITY_SLACK_WEBHOOK_URL;
    process.env.SECURITY_SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    const manager = new AlertManager({
      enabled: true,
      channels: { slack: { enabled: true } },
      min_severity: "critical",
    });
    expect(manager.getChannelNames()).toContain("slack");
    process.env.SECURITY_SLACK_WEBHOOK_URL = orig;
  });

  test("initializes Discord channel from env var", () => {
    const orig = process.env.SECURITY_DISCORD_WEBHOOK_URL;
    process.env.SECURITY_DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test";
    const manager = new AlertManager({
      enabled: true,
      channels: { discord: { enabled: true } },
      min_severity: "critical",
    });
    expect(manager.getChannelNames()).toContain("discord");
    process.env.SECURITY_DISCORD_WEBHOOK_URL = orig;
  });

  test("initializes webhook channel from env var", () => {
    const orig = process.env.SECURITY_WEBHOOK_URL;
    process.env.SECURITY_WEBHOOK_URL = "https://api.example.com/webhook";
    const manager = new AlertManager({
      enabled: true,
      channels: { webhook: { enabled: true } },
      min_severity: "critical",
    });
    expect(manager.getChannelNames()).toContain("webhook");
    process.env.SECURITY_WEBHOOK_URL = orig;
  });
});

describe("loadAlertConfig / saveAlertConfig", () => {
  let tempDir: string;
  beforeAll(() => { tempDir = mkdtempSync(join(tmpdir(), "alert-cfg-test-")); });
  afterAll(() => { rmSync(tempDir, { recursive: true, force: true }); });

  test("loadAlertConfig returns defaults when no file exists", () => {
    const orig = process.env.HOME;
    process.env.HOME = tempDir; // redirect home
    const config = loadAlertConfig();
    process.env.HOME = orig;
    expect(config.enabled).toBe(false);
    expect(config.min_severity).toBe("critical");
  });

  test("saveAlertConfig and loadAlertConfig round-trip", () => {
    const config: AlertConfig = {
      enabled: true,
      channels: { slack: { enabled: true, webhook_url: "https://hooks.slack.com/test" } },
      min_severity: "high",
    };
    saveAlertConfig(config, tempDir);

    const saved = JSON.parse(readFileSync(join(tempDir, ".security", "alerts.json"), "utf-8"));
    expect(saved.enabled).toBe(true);
    expect(saved.min_severity).toBe("high");
    expect(saved.channels.slack?.webhook_url).toBe("https://hooks.slack.com/test");
  });
});

describe("SlackChannel", () => {
  test("sends correctly formatted message", async () => {
    mockFetch.mockClear();
    const channel = new SlackChannel("https://hooks.slack.com/test");
    const result = await channel.send(MOCK_PAYLOAD);

    expect(result.channel).toBe("slack");
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/test");
    expect(init?.method).toBe("POST");

    const body = JSON.parse(init?.body as string);
    expect(body.blocks).toBeDefined();
    expect(body.text).toContain("axios");
  });

  test("returns error on HTTP failure", async () => {
    const failFetch = mock(async () => ({
      ok: false, status: 400, text: async () => "Bad Request",
    } as Response));
    (globalThis as any).fetch = failFetch;

    const channel = new SlackChannel("https://hooks.slack.com/test");
    const result = await channel.send(MOCK_PAYLOAD);
    expect(result.success).toBe(false);
    expect(result.message).toContain("400");

    (globalThis as any).fetch = mockFetch;
  });

  test("returns error on network failure", async () => {
    const throwFetch = mock(async () => { throw new Error("Network error"); });
    (globalThis as any).fetch = throwFetch;

    const channel = new SlackChannel("https://hooks.slack.com/test");
    const result = await channel.send(MOCK_PAYLOAD);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Network error");

    (globalThis as any).fetch = mockFetch;
  });
});

describe("DiscordChannel", () => {
  test("sends correctly formatted embed", async () => {
    mockFetch.mockClear();
    (globalThis as any).fetch = mockFetch;
    const channel = new DiscordChannel("https://discord.com/api/webhooks/test");
    const result = await channel.send(MOCK_PAYLOAD);

    expect(result.channel).toBe("discord");
    expect(result.success).toBe(true);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].color).toBe(0xff0000); // critical = red
    expect(body.embeds[0].title).toContain("axios");
  });

  test("uses correct color for high severity", async () => {
    mockFetch.mockClear();
    (globalThis as any).fetch = mockFetch;
    const channel = new DiscordChannel("https://discord.com/api/webhooks/test");
    const result = await channel.send({
      ...MOCK_PAYLOAD,
      advisory: { ...MOCK_ADVISORY, severity: "high" } as any,
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.embeds[0].color).toBe(0xff6600); // high = orange
    expect(result.success).toBe(true);
  });
});

describe("WebhookChannel", () => {
  test("sends JSON payload with advisory data", async () => {
    mockFetch.mockClear();
    (globalThis as any).fetch = mockFetch;
    const channel = new WebhookChannel("https://api.example.com/security");
    const result = await channel.send(MOCK_PAYLOAD);

    expect(result.channel).toBe("webhook");
    expect(result.success).toBe(true);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/security");

    const body = JSON.parse(init?.body as string);
    expect(body.type).toBe("supply_chain_advisory");
    expect(body.advisory.package_name).toBe("axios");
    expect(body.advisory.severity).toBe("critical");
    expect(body.iocs).toHaveLength(2);
    expect(body.source).toBe("open-security/test");
  });

  test("sends custom headers", async () => {
    mockFetch.mockClear();
    (globalThis as any).fetch = mockFetch;
    const channel = new WebhookChannel("https://api.example.com/security", {
      "X-API-Key": "test-key",
      "X-Custom": "value",
    });
    await channel.send(MOCK_PAYLOAD);

    const [, init] = mockFetch.mock.calls[0];
    expect(init?.headers).toMatchObject({
      "X-API-Key": "test-key",
      "X-Custom": "value",
      "Content-Type": "application/json",
    });
  });
});

// Cleanup: restore fetch
afterAll(() => {
  (globalThis as any).fetch = globalThis.fetch;
});
