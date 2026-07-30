import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  listWebhooks,
  addWebhook,
  removeWebhook,
  _resetConfigCache,
} from "./webhooks";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_CONFIG_DIR = join(tmpdir(), `conversations-test-webhooks-mgmt-${Date.now()}`);
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

beforeEach(() => {
  mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  process.env.CONVERSATIONS_CONFIG_PATH = TEST_CONFIG_PATH;
  _resetConfigCache();
});

afterEach(() => {
  delete process.env.CONVERSATIONS_CONFIG_PATH;
  _resetConfigCache();
  try { rmSync(TEST_CONFIG_DIR, { recursive: true }); } catch {}
});

describe("listWebhooks", () => {
  test("returns empty array when no config exists", () => {
    expect(listWebhooks()).toEqual([]);
  });

  test("returns empty array when config has no webhooks", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    expect(listWebhooks()).toEqual([]);
  });

  test("returns configured webhooks", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [
        { url: "https://example.com/hook1", events: ["dm", "task"] },
        { url: "https://example.com/hook2", events: ["channel"], agent: "bob" },
      ],
    }));
    const hooks = listWebhooks();
    expect(hooks).toHaveLength(2);
    expect(hooks[0].url).toBe("https://example.com/hook1");
    expect(hooks[0].events).toEqual(["dm", "task"]);
    expect(hooks[1].agent).toBe("bob");
  });
});

describe("addWebhook", () => {
  test("adds a webhook to empty config", async () => {
    const result = await addWebhook("https://example.com/hook", ["dm"]);
    expect(result.success).toBe(true);
    expect(result.webhook?.url).toBe("https://example.com/hook");
    expect(result.index).toBe(0);

    const hooks = listWebhooks();
    expect(hooks).toHaveLength(1);
    expect(hooks[0].url).toBe("https://example.com/hook");
  });

  test("adds a second webhook", async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/first", events: ["dm"] }],
    }));

    const result = await addWebhook("https://example.com/second", ["task", "channel"]);
    expect(result.success).toBe(true);
    expect(result.index).toBe(1);

    const hooks = listWebhooks();
    expect(hooks).toHaveLength(2);
  });

  test("adds webhook with agent scoping", async () => {
    const result = await addWebhook("https://example.com/hook", ["dm"], "bob");
    expect(result.success).toBe(true);
    expect(result.webhook?.agent).toBe("bob");
  });

  test("preserves existing webhook event order when adding a different webhook", async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/hook", events: ["task", "dm"] }],
    }));

    const result = await addWebhook("https://example.com/hook", ["channel"]);

    expect(result.success).toBe(true);
    const config = JSON.parse(readFileSync(TEST_CONFIG_PATH, "utf-8"));
    expect(config.webhooks[0].events).toEqual(["task", "dm"]);
  });

  test("does not mutate the caller's events array", async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/hook", events: ["channel"] }],
    }));
    const events = ["task", "dm"];

    const result = await addWebhook("https://example.com/hook", events);

    expect(result.success).toBe(true);
    expect(events).toEqual(["task", "dm"]);
  });

  test("rejects an exact duplicate webhook", async () => {
    await addWebhook("https://example.com/hook", ["dm", "task"]);
    const result = await addWebhook("https://example.com/hook", ["dm", "task"]);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Webhook already exists");
  });

  test("rejects a duplicate webhook with events in a different order", async () => {
    await addWebhook("https://example.com/hook", ["dm", "task"]);
    const result = await addWebhook("https://example.com/hook", ["task", "dm"]);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Webhook already exists");
  });

  test("allows a webhook with a genuinely different event set", async () => {
    await addWebhook("https://example.com/hook", ["dm", "task"]);
    const result = await addWebhook("https://example.com/hook", ["dm", "channel"]);
    expect(result.success).toBe(true);
  });

  test("rejects empty events array", async () => {
    const result = await addWebhook("https://example.com/hook", []);
    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  test("rejects invalid event type", async () => {
    const result = await addWebhook("https://example.com/hook", ["invalid_event"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid event");
  });

  test("rejects invalid URL", async () => {
    const result = await addWebhook("not-a-url", ["dm"]);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });
});

describe("removeWebhook", () => {
  test("removes webhook by index", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [
        { url: "https://example.com/a", events: ["dm"] },
        { url: "https://example.com/b", events: ["task"] },
      ],
    }));

    const result = removeWebhook(0);
    expect(result.success).toBe(true);
    expect(result.removed?.url).toBe("https://example.com/a");

    const hooks = listWebhooks();
    expect(hooks).toHaveLength(1);
    expect(hooks[0].url).toBe("https://example.com/b");
  });

  test("fails on empty webhooks list", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
    const result = removeWebhook(0);
    expect(result.success).toBe(false);
    expect(result.error).toBe("No webhooks configured");
  });

  test("fails on out-of-range index", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/a", events: ["dm"] }],
    }));

    const result = removeWebhook(5);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid index");
  });

  test("fails on negative index", () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      webhooks: [{ url: "https://example.com/a", events: ["dm"] }],
    }));

    const result = removeWebhook(-1);
    expect(result.success).toBe(false);
  });

  test("creates config file if it doesn't exist", async () => {
    // No config file exists yet
    const result = await addWebhook("https://example.com/new", ["task"]);
    expect(result.success).toBe(true);
    expect(readFileSync(TEST_CONFIG_PATH, "utf-8")).toContain("https://example.com/new");
  });
});
