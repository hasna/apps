process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { getDatabase, resetDatabase } from "./database.js";
import {
  createWebhookHook,
  getWebhookHook,
  listWebhookHooks,
  updateWebhookHook,
  deleteWebhookHook,
  recordWebhookInvocation,
  validateWebhookHandlerUrl,
} from "./webhook_hooks.js";

describe("webhook hooks", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("creates and retrieves a webhook hook", () => {
    const db = getDatabase();
    const hook = createWebhookHook(
      {
        type: "PostMemorySave",
        handlerUrl: "https://example.com/hook",
        priority: 10,
        blocking: true,
        description: "Test webhook",
      },
      db
    );

    expect(hook.id).toHaveLength(8);
    expect(hook.type).toBe("PostMemorySave");
    expect(hook.handlerUrl).toBe("https://example.com/hook");
    expect(hook.priority).toBe(10);
    expect(hook.blocking).toBe(true);
    expect(hook.enabled).toBe(true);
    expect(hook.invocationCount).toBe(0);
    expect(hook.failureCount).toBe(0);

    const fetched = getWebhookHook(hook.id, db);
    expect(fetched?.description).toBe("Test webhook");
  });

  it("lists hooks filtered by type and enabled state", () => {
    const db = getDatabase();
    createWebhookHook({ type: "PostMemorySave", handlerUrl: "https://a.test/h" }, db);
    const disabled = createWebhookHook(
      { type: "OnSessionStart", handlerUrl: "https://b.test/h" },
      db
    );
    updateWebhookHook(disabled.id, { enabled: false }, db);

    expect(listWebhookHooks({}, db)).toHaveLength(2);
    expect(listWebhookHooks({ type: "PostMemorySave" }, db)).toHaveLength(1);
    expect(listWebhookHooks({ enabled: true }, db)).toHaveLength(1);
  });

  it("updates and deletes webhook hooks", () => {
    const db = getDatabase();
    const hook = createWebhookHook(
      { type: "PostMemorySave", handlerUrl: "https://c.test/h" },
      db
    );

    const updated = updateWebhookHook(
      hook.id,
      { enabled: false, priority: 99, description: "Updated" },
      db
    );
    expect(updated?.enabled).toBe(false);
    expect(updated?.priority).toBe(99);
    expect(updated?.description).toBe("Updated");
    expect(updateWebhookHook("missing", { enabled: false }, db)).toBeNull();

    expect(deleteWebhookHook(hook.id, db)).toBe(true);
    expect(getWebhookHook(hook.id, db)).toBeNull();
    expect(deleteWebhookHook(hook.id, db)).toBe(false);
  });

  it("tracks invocation and failure counts", () => {
    const db = getDatabase();
    const hook = createWebhookHook(
      { type: "PostMemorySave", handlerUrl: "https://d.test/h" },
      db
    );

    recordWebhookInvocation(hook.id, true, db);
    recordWebhookInvocation(hook.id, false, db);

    const stats = getWebhookHook(hook.id, db)!;
    expect(stats.invocationCount).toBe(2);
    expect(stats.failureCount).toBe(1);
  });
});

describe("validateWebhookHandlerUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(() => validateWebhookHandlerUrl("https://example.com/hook")).not.toThrow();
    expect(() => validateWebhookHandlerUrl("http://example.com:8080/hook")).not.toThrow();
    expect(() => validateWebhookHandlerUrl("https://hooks.example.com/path?q=1")).not.toThrow();
    expect(() => validateWebhookHandlerUrl("http://8.8.8.8/hook")).not.toThrow();
    expect(() => validateWebhookHandlerUrl("http://172.32.0.1/hook")).not.toThrow();
    expect(() => validateWebhookHandlerUrl("http://[2001:db8::1]/hook")).not.toThrow();
  });

  it("rejects non-http(s) schemes and unparseable URLs", () => {
    expect(() => validateWebhookHandlerUrl("ftp://example.com/hook")).toThrow();
    expect(() => validateWebhookHandlerUrl("file:///etc/passwd")).toThrow();
    expect(() => validateWebhookHandlerUrl("not a url")).toThrow();
    expect(() => validateWebhookHandlerUrl("")).toThrow();
  });

  it("rejects loopback, link-local, private, and metadata targets", () => {
    const blocked = [
      "http://127.0.0.1:43129/capture",
      "http://127.1/capture", // inet_aton shorthand for 127.0.0.1
      "http://2130706433/capture", // decimal shorthand for 127.0.0.1
      "http://0x7f000001/capture", // hex shorthand for 127.0.0.1
      "http://localhost/capture",
      "http://Localhost/capture",
      "http://foo.localhost/capture",
      "http://[::1]/capture",
      "http://[::ffff:127.0.0.1]/capture", // IPv4-mapped loopback
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/capture",
      "http://172.16.0.1/capture",
      "http://172.31.255.254/capture",
      "http://192.168.1.1/capture",
      "http://[fc00::1]/capture",
      "http://[fd00::1]/capture",
      "http://[fe80::1]/capture",
      "http://0.0.0.0/capture",
      "http://[::]/capture",
    ];
    for (const url of blocked) {
      expect(() => validateWebhookHandlerUrl(url), url).toThrow(/not allowed/);
    }
  });

  it("rejects credentials embedded in the URL", () => {
    expect(() => validateWebhookHandlerUrl("http://user:pass@example.com/hook")).toThrow();
  });
});
