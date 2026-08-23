import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createWebhook, getWebhook, listWebhooks, deleteWebhook, listDeliveries, dispatchWebhook, validateWebhookUrl } from "./webhooks.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createWebhook", () => {
  it("should create a webhook with url only", () => {
    const wh = createWebhook({ url: "https://example.com/hook" }, db);
    expect(wh.id).toBeTruthy();
    expect(wh.url).toBe("https://example.com/hook");
    expect(wh.active).toBe(true);
    expect(wh.events).toEqual([]);
    expect(wh.secret).toBeNull();
  });

  it("should create with events and secret", () => {
    const wh = createWebhook({ url: "https://x.com/h", events: ["task.completed"], secret: "s3cr3t" }, db);
    expect(wh.events).toEqual(["task.completed"]);
    expect(wh.secret).toBe("s3cr3t");
  });

  it("should create with multiple events", () => {
    const wh = createWebhook({ url: "https://x.com/h", events: ["task.created", "task.completed", "task.updated"] }, db);
    expect(wh.events).toEqual(["task.created", "task.completed", "task.updated"]);
  });

  it("should generate unique ids", () => {
    const wh1 = createWebhook({ url: "https://a.com" }, db);
    const wh2 = createWebhook({ url: "https://b.com" }, db);
    expect(wh1.id).not.toBe(wh2.id);
  });

  it("should set created_at timestamp", () => {
    const wh = createWebhook({ url: "https://example.com" }, db);
    expect(wh.created_at).toBeTruthy();
  });

  it("should create with scope filters", () => {
    const wh = createWebhook({
      url: "https://scoped.com/hook",
      events: ["task.created"],
      project_id: "proj-123",
      task_list_id: "list-456",
      agent_id: "agent-789",
      task_id: "task-abc",
    }, db);
    expect(wh.project_id).toBe("proj-123");
    expect(wh.task_list_id).toBe("list-456");
    expect(wh.agent_id).toBe("agent-789");
    expect(wh.task_id).toBe("task-abc");
  });

  it("should default scope filters to null", () => {
    const wh = createWebhook({ url: "https://noscope.com" }, db);
    expect(wh.project_id).toBeNull();
    expect(wh.task_list_id).toBeNull();
    expect(wh.agent_id).toBeNull();
    expect(wh.task_id).toBeNull();
  });
});

describe("getWebhook", () => {
  it("should get by id", () => {
    const wh = createWebhook({ url: "https://c.com" }, db);
    const found = getWebhook(wh.id, db);
    expect(found).not.toBeNull();
    expect(found!.url).toBe("https://c.com");
  });

  it("should return null for non-existent", () => {
    expect(getWebhook("nonexistent", db)).toBeNull();
  });

  it("should return correct events as array", () => {
    const wh = createWebhook({ url: "https://x.com", events: ["task.created"] }, db);
    const found = getWebhook(wh.id, db);
    expect(Array.isArray(found!.events)).toBe(true);
    expect(found!.events).toEqual(["task.created"]);
  });

  it("should return active as boolean", () => {
    const wh = createWebhook({ url: "https://x.com" }, db);
    const found = getWebhook(wh.id, db);
    expect(typeof found!.active).toBe("boolean");
    expect(found!.active).toBe(true);
  });

  it("should preserve scope filters on get", () => {
    const wh = createWebhook({ url: "https://x.com", project_id: "p1", agent_id: "a1" }, db);
    const found = getWebhook(wh.id, db);
    expect(found!.project_id).toBe("p1");
    expect(found!.agent_id).toBe("a1");
    expect(found!.task_list_id).toBeNull();
    expect(found!.task_id).toBeNull();
  });
});

describe("listWebhooks", () => {
  it("should list all webhooks", () => {
    createWebhook({ url: "https://a.com" }, db);
    createWebhook({ url: "https://b.com" }, db);
    expect(listWebhooks(db).length).toBe(2);
  });

  it("should return empty array when none exist", () => {
    expect(listWebhooks(db)).toEqual([]);
  });

  it("should return all webhooks", () => {
    createWebhook({ url: "https://first.com" }, db);
    createWebhook({ url: "https://second.com" }, db);
    const webhooks = listWebhooks(db);
    const urls = webhooks.map(w => w.url);
    expect(urls).toContain("https://first.com");
    expect(urls).toContain("https://second.com");
  });
});

describe("deleteWebhook", () => {
  it("should delete a webhook and return true", () => {
    const wh = createWebhook({ url: "https://d.com" }, db);
    expect(deleteWebhook(wh.id, db)).toBe(true);
    expect(listWebhooks(db).length).toBe(0);
  });

  it("should return false for non-existent", () => {
    expect(deleteWebhook("nonexistent", db)).toBe(false);
  });

  it("should only delete the specified webhook", () => {
    const wh1 = createWebhook({ url: "https://keep.com" }, db);
    const wh2 = createWebhook({ url: "https://delete.com" }, db);
    deleteWebhook(wh2.id, db);
    expect(listWebhooks(db).length).toBe(1);
    expect(getWebhook(wh1.id, db)).not.toBeNull();
  });

  it("should not be retrievable after deletion", () => {
    const wh = createWebhook({ url: "https://gone.com" }, db);
    deleteWebhook(wh.id, db);
    expect(getWebhook(wh.id, db)).toBeNull();
  });

  it("should cascade delete webhook deliveries", () => {
    const wh = createWebhook({ url: "https://cascade.com" }, db);
    // Manually insert a delivery
    db.run(
      "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, attempt) VALUES (?, ?, ?, ?, ?, ?)",
      ["del-1", wh.id, "task.created", "{}", 200, 1],
    );
    expect(listDeliveries(wh.id, 10, db)).toHaveLength(1);

    deleteWebhook(wh.id, db);
    expect(listDeliveries(wh.id, 10, db)).toHaveLength(0);
  });
});

describe("listDeliveries", () => {
  it("should return empty when no deliveries exist", () => {
    expect(listDeliveries(undefined, 50, db)).toEqual([]);
  });

  it("should list deliveries for a specific webhook", () => {
    const wh = createWebhook({ url: "https://log.com" }, db);
    db.run(
      "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, attempt) VALUES (?, ?, ?, ?, ?, ?)",
      ["d1", wh.id, "task.created", '{"test":true}', 200, 1],
    );
    db.run(
      "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, attempt) VALUES (?, ?, ?, ?, ?, ?)",
      ["d2", wh.id, "task.completed", '{"test":true}', 500, 1],
    );
    const deliveries = listDeliveries(wh.id, 50, db);
    expect(deliveries).toHaveLength(2);
  });

  it("should list all deliveries when no webhook_id filter", () => {
    const wh1 = createWebhook({ url: "https://a.com" }, db);
    const wh2 = createWebhook({ url: "https://b.com" }, db);
    db.run(
      "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, attempt) VALUES (?, ?, ?, ?, ?, ?)",
      ["d1", wh1.id, "task.created", "{}", 200, 1],
    );
    db.run(
      "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, attempt) VALUES (?, ?, ?, ?, ?, ?)",
      ["d2", wh2.id, "task.completed", "{}", 200, 1],
    );
    const all = listDeliveries(undefined, 50, db);
    expect(all).toHaveLength(2);
  });

  it("should respect limit", () => {
    const wh = createWebhook({ url: "https://limit.com" }, db);
    for (let i = 0; i < 5; i++) {
      db.run(
        "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, attempt) VALUES (?, ?, ?, ?, ?, ?)",
        [`d${i}`, wh.id, "task.created", "{}", 200, 1],
      );
    }
    expect(listDeliveries(wh.id, 3, db)).toHaveLength(3);
  });
});

describe("dispatchWebhook scope filtering", () => {
  it("should not throw when dispatching with no webhooks", async () => {
    await dispatchWebhook("task.created", { id: "t1", project_id: "p1" }, db);
  });

  it("should match unscoped webhooks to any event", () => {
    const wh = createWebhook({ url: "https://unscoped.com" }, db);
    expect(wh.project_id).toBeNull();
    expect(wh.agent_id).toBeNull();
  });

  it("should create scoped webhook that only fires for matching project", () => {
    const wh = createWebhook({ url: "https://scoped.com", project_id: "proj-abc" }, db);
    expect(wh.project_id).toBe("proj-abc");
  });
});

describe("validateWebhookUrl", () => {
  it("should allow valid HTTPS URLs", () => {
    const result = validateWebhookUrl("https://example.com/webhook");
    expect(result.valid).toBe(true);
  });

  it("should reject HTTP URLs", () => {
    const result = validateWebhookUrl("http://example.com/webhook");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("error");
  });

  it("should reject localhost", () => {
    const result = validateWebhookUrl("https://localhost/webhook");
    expect(result.valid).toBe(false);
  });

  it("should reject 127.0.0.1", () => {
    const result = validateWebhookUrl("https://127.0.0.1/webhook");
    expect(result.valid).toBe(false);
  });

  it("should reject 0.0.0.0", () => {
    const result = validateWebhookUrl("https://0.0.0.0/webhook");
    expect(result.valid).toBe(false);
  });

  it("should reject cloud metadata endpoint 169.254.169.254", () => {
    const result = validateWebhookUrl("https://169.254.169.254/latest/meta-data/");
    expect(result.valid).toBe(false);
  });

  it("should reject any 169.254.x.x address", () => {
    const result = validateWebhookUrl("https://169.254.1.1/test");
    expect(result.valid).toBe(false);
  });

  it("should reject 10.x.x.x private range", () => {
    const result = validateWebhookUrl("https://10.0.0.1/webhook");
    expect(result.valid).toBe(false);
  });

  it("should reject 172.16-31.x.x private range", () => {
    expect(validateWebhookUrl("https://172.16.0.1/webhook").valid).toBe(false);
    expect(validateWebhookUrl("https://172.20.0.1/webhook").valid).toBe(false);
    expect(validateWebhookUrl("https://172.31.0.1/webhook").valid).toBe(false);
  });

  it("should allow 172.15.x.x (outside private range)", () => {
    expect(validateWebhookUrl("https://172.15.0.1/webhook").valid).toBe(true);
  });

  it("should reject 192.168.x.x private range", () => {
    const result = validateWebhookUrl("https://192.168.1.1/webhook");
    expect(result.valid).toBe(false);
  });

  it("should allow 192.169.x.x (outside private range)", () => {
    expect(validateWebhookUrl("https://192.169.0.1/webhook").valid).toBe(true);
  });

  it("should reject IPv6 private fc00 range", () => {
    const result = validateWebhookUrl("https://[fc00::1]/webhook");
    expect(result.valid).toBe(false);
  });

  it("should reject IPv6 link-local fe80 range", () => {
    const result = validateWebhookUrl("https://[fe80::1]/webhook");
    expect(result.valid).toBe(false);
  });

  it("should reject invalid URLs", () => {
    const result = validateWebhookUrl("not-a-url");
    expect(result.valid).toBe(false);
  });
});

describe("deliverWebhook redirect handling", () => {
  it("must not follow a 3xx redirect from a webhook URL (SSRF via redirect)", async () => {
    // Regression for todos row 3f81aefd: the fetch() in deliverWebhook used
    // Bun's default redirect:"follow", so a public HTTPS webhook URL answering
    // 307 transparently re-issued the full POST body + X-Webhook-Signature HMAC
    // header at the redirect target — bypassing the SSRF URL/IP validation,
    // which only ever inspects the original URL. The fix pins redirect:"manual".
    //
    // The delivery-time SSRF checks block localhost/private IPs by design, so a
    // real local redirector is unreachable through the real code path; the
    // network hop is stubbed with a fetch recorder that simulates Bun's
    // redirect-following behaviour (a second call to the Location target) when
    // redirect:"manual" is absent. The configured URL uses the reserved
    // ".invalid" TLD (RFC 2606 — never resolves): Bun.dns.lookup throws
    // ENOTFOUND, which the delivery path treats as pass-through, so the test
    // stays hermetic — no sockets, no real DNS.
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetchCalls.push({ url, init });
      if (init?.redirect === "manual") {
        // Fixed behaviour: the 3xx is returned to the caller, never followed.
        return Promise.resolve(new Response(null, { status: 307, headers: { Location: "http://127.0.0.1:9/meta" } }));
      }
      // Buggy behaviour (Bun default follow): the same POST — body and
      // signature header included — is re-issued at the redirect target.
      fetchCalls.push({ url: "http://127.0.0.1:9/meta", init });
      return Promise.resolve(new Response("INTERNAL_TARGET_HIT", { status: 200 }));
    }) as typeof fetch;

    try {
      const wh = createWebhook(
        { url: "https://redirector.invalid/hook", events: ["task.created"], secret: "s3cr3t" },
        db,
      );
      await dispatchWebhook("task.created", { id: "t-1", title: "secret task" }, db);

      // deliverWebhook is fire-and-forget from dispatchWebhook; bounded poll
      // until the delivery row lands.
      const deadline = Date.now() + 2000;
      while (listDeliveries(wh.id, 50, db).length === 0 && Date.now() < deadline) {
        await Bun.sleep(10);
      }

      // The redirect target received nothing: fetch was invoked exactly once,
      // for the configured URL only, with redirect pinned to manual.
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]!.url).toBe("https://redirector.invalid/hook");
      expect(fetchCalls[0]!.init?.redirect).toBe("manual");

      // The delivery is recorded as the blocked 3xx, not as a followed 200.
      const deliveries = listDeliveries(wh.id, 50, db);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.status_code).toBe(307);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("createWebhook URL validation", () => {
  it("should reject HTTP URL", () => {
    expect(() => createWebhook({ url: "http://example.com" }, db)).toThrow("Invalid webhook URL");
  });

  it("should reject localhost URL", () => {
    expect(() => createWebhook({ url: "https://localhost/hook" }, db)).toThrow("localhost");
  });

  it("should reject private IP URL", () => {
    expect(() => createWebhook({ url: "https://192.168.1.1/hook" }, db)).toThrow("private IP");
  });

  it("should reject invalid URL", () => {
    expect(() => createWebhook({ url: "garbage" }, db)).toThrow("Invalid webhook URL");
  });
});
