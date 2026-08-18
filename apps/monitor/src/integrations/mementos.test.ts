/**
 * MON-V2-08 — Mementos native adapter.
 *
 * Gate: tests use `MementosClient.saveMemory`; repeated bucket/key effects are
 * idempotent; required and non-required failure states are distinct.
 *
 * The tests exercise the REAL `@hasna/mementos/sdk` `MementosClient` with an
 * injected `fetch` fixture, so the exact package-owned surface
 * (`MementosClient.saveMemory` → POST /v1/memories) is what the adapter calls.
 * No hand-rolled HTTP path exists in the adapter.
 */
import { describe, expect, test } from "bun:test";
import { MementosClient } from "@hasna/mementos/sdk";
import type { DoctorReport } from "../doctor/index.js";
import { MementosAdapter, saveHealthMemory, type MementosEffectContext } from "./mementos";

interface MemoryRow {
  id: string;
  key: string;
  value: string;
  scope: string;
  summary: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

/** In-memory fake of the mementos /v1/memories upsert (merge dedupe on key). */
function memoryStoreFetch(store: Map<string, MemoryRow>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (!url.endsWith("/v1/memories") || init?.method !== "POST") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (!body["key"] || !body["value"]) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: key, value" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const existing = [...store.values()].find((r) => r.key === body["key"]);
    if (existing) {
      // merge upsert: update in place, version + 1, id unchanged
      existing.value = String(body["value"]);
      existing.summary = body["summary"] ? String(body["summary"]) : null;
      existing.tags = Array.isArray(body["tags"]) ? body["tags"].map(String) : [];
      existing.version += 1;
      existing.updated_at = new Date().toISOString();
      return new Response(JSON.stringify(existing), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    const row: MemoryRow = {
      id: `mem-${store.size + 1}`,
      key: String(body["key"]),
      value: String(body["value"]),
      scope: body["scope"] ? String(body["scope"]) : "private",
      summary: body["summary"] ? String(body["summary"]) : null,
      tags: Array.isArray(body["tags"]) ? body["tags"].map(String) : [],
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    store.set(row.id, row);
    return new Response(JSON.stringify(row), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function failingFetch(status: number, message: string): typeof fetch {
  return (async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function networkFailureFetch(): typeof fetch {
  return (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
}

const baseContext: MementosEffectContext = {
  slug: "db-check",
  runId: "run-1",
  actionIndex: 0,
  target: "station01",
  operation: "check",
};

function clientWith(fetchImpl: typeof fetch): MementosClient {
  return new MementosClient({ baseUrl: "http://mem.test", fetch: fetchImpl });
}

describe("MementosAdapter — package-owned surface", () => {
  test("saves through MementosClient.saveMemory and records the returned memory pointer", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
    });

    const outcome = await adapter.save(baseContext, {
      value: "station01 db check ok",
      summary: "db-check passed",
      tags: ["monitor", "db"],
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.memoryId).toBe("mem-1");
      expect(outcome.memory.key).toBe("db-check:check:station01");
      expect(outcome.memory.value).toBe("station01 db check ok");
      expect(store.size).toBe(1);
    }
  });

  test("key template renders bucket, slug, run, action, target and operation variables", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{bucket}/{slug}/{runId}/{actionIndex}/{target}/{operation}",
    });

    const outcome = await adapter.save(baseContext, { value: "v" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.memory.key).toBe("monitor/db-check/run-1/0/station01/check");
    }
  });

  test("repeated bucket/key effects are idempotent: one memory row, updated in place", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
    });

    const first = await adapter.save(baseContext, { value: "attempt-1" });
    const second = await adapter.save(baseContext, { value: "attempt-2" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      // same effect key -> same memory row, no duplicate
      expect(store.size).toBe(1);
      expect(second.memoryId).toBe(first.memoryId);
      expect(second.memory.version).toBe(2);
      expect(second.memory.value).toBe("attempt-2");
    }
  });

  test("different targets and operations produce distinct memory keys", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
    });

    await adapter.save({ ...baseContext, target: "station01" }, { value: "a" });
    await adapter.save({ ...baseContext, target: "station02" }, { value: "b" });
    await adapter.save({ ...baseContext, operation: "repair" }, { value: "c" });

    expect(store.size).toBe(3);
    const keys = [...store.values()].map((r) => r.key).sort();
    expect(keys).toEqual([
      "db-check:check:station01",
      "db-check:check:station02",
      "db-check:repair:station01",
    ]);
  });

  test("key template rendering that yields an empty string falls back to a stable effect-key-derived key", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));
    // "{missing}" renders to "" for this context — the adapter must not save an
    // empty key; it falls back to a stable bucket:effect-key memory key.
    const adapter = new MementosAdapter(client, { bucket: "monitor", keyTemplate: "{missing}" });

    const first = await adapter.save(baseContext, { value: "v1" });
    const second = await adapter.save(baseContext, { value: "v2" });
    const other = await adapter.save({ ...baseContext, target: "station02" }, { value: "v3" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(other.ok).toBe(true);
    if (first.ok && second.ok && other.ok) {
      expect(store.size).toBe(2);
      expect(first.memory.key.startsWith("monitor:")).toBe(true);
      expect(first.memory.key).toBe(second.memory.key); // stable across repeats
      expect(other.memory.key).not.toBe(first.memory.key); // distinct per effect
    }
  });

  test("rejects an empty bucket in configuration", () => {
    const client = clientWith(memoryStoreFetch(new Map()));
    expect(() => new MementosAdapter(client, { bucket: "", keyTemplate: "{slug}" })).toThrow(
      /bucket/,
    );
  });

  test("rejects a missing key template in configuration", () => {
    const client = clientWith(memoryStoreFetch(new Map()));
    expect(() => new MementosAdapter(client, { bucket: "monitor", keyTemplate: "" })).toThrow(
      /keyTemplate/,
    );
  });
});

describe("MementosAdapter — required vs non-required failure states", () => {
  test("non-required confirmed failure is recorded and does not block the run", async () => {
    const client = clientWith(failingFetch(400, "Missing required fields: key, value"));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
      required: false,
    });

    const outcome = await adapter.save(baseContext, { value: "v" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.required).toBe(false);
      expect(outcome.runBlocking).toBe(false);
      expect(outcome.failureClass).toBe("confirmed");
      expect(outcome.error).toContain("400");
    }
  });

  test("required confirmed failure blocks the run outcome", async () => {
    const client = clientWith(failingFetch(400, "Missing required fields: key, value"));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
      required: true,
    });

    const outcome = await adapter.save(baseContext, { value: "v" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.required).toBe(true);
      expect(outcome.runBlocking).toBe(true);
      expect(outcome.failureClass).toBe("confirmed");
    }
  });

  test("required by default only when config says so — default is non-required", async () => {
    const client = clientWith(failingFetch(400, "boom"));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}",
    });

    const outcome = await adapter.save(baseContext, { value: "v" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.required).toBe(false);
      expect(outcome.runBlocking).toBe(false);
    }
  });

  test("network failure is an unknown outcome and does not block even when required", async () => {
    const client = clientWith(networkFailureFetch());
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
      required: true,
    });

    const outcome = await adapter.save(baseContext, { value: "v" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.required).toBe(true);
      expect(outcome.runBlocking).toBe(false); // reconcile path, not a confirmed failure
      expect(outcome.failureClass).toBe("unknown");
    }
  });

  test("server 5xx is an unknown outcome (write may have landed; stable key makes retry safe)", async () => {
    const client = clientWith(failingFetch(500, "internal"));
    const adapter = new MementosAdapter(client, {
      bucket: "monitor",
      keyTemplate: "{slug}:{operation}:{target}",
      required: true,
    });

    const outcome = await adapter.save(baseContext, { value: "v" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failureClass).toBe("unknown");
      expect(outcome.runBlocking).toBe(false);
      expect(outcome.key).toBe("db-check:check:station01");
    }
  });
});

describe("saveHealthMemory — legacy dispatcher surface, SDK-backed", () => {
  const dummyReport: DoctorReport = {
    machineId: "test-machine",
    ts: 1_752_000_000_000,
    overallStatus: "ok",
    checks: [
      {
        name: "cpu",
        severity: "warning",
        status: "ok",
        message: "cpu load fine",
        value: 10,
        threshold: 80,
      },
    ],
    recommendedActions: [],
  };

  test("routes through MementosClient.saveMemory (no direct HTTP path)", async () => {
    const store = new Map<string, MemoryRow>();
    const seen: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      seen.push({ url: String(input), method: String(init?.method), body });
      return memoryStoreFetch(store)(input, init);
    }) as typeof fetch;
    const client = clientWith(fetchImpl);

    await saveHealthMemory("test-machine", dummyReport, { enabled: true }, client);

    // The old direct-HTTP implementation posted a content-only body to
    // /api/memories. The SDK-backed surface must POST key+value to /v1/memories.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://mem.test/v1/memories");
    expect(seen[0]!.method).toBe("POST");
    expect(typeof seen[0]!.body["key"]).toBe("string");
    expect(seen[0]!.body["key"]).toBe("health:test-machine");
    expect(typeof seen[0]!.body["value"]).toBe("string");
    expect(String(seen[0]!.body["value"])).toContain("Machine health snapshot");
    expect(store.size).toBe(1);
  });

  test("repeated snapshots for the same machine upsert one memory row", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));

    await saveHealthMemory("test-machine", dummyReport, { enabled: true }, client);
    await saveHealthMemory(
      "test-machine",
      { ...dummyReport, overallStatus: "warn" },
      { enabled: true },
      client,
    );
    await saveHealthMemory("other-machine", dummyReport, { enabled: true }, client);

    expect(store.size).toBe(2);
    const rows = [...store.values()];
    const machineRows = rows.filter((r) => r.key === "health:test-machine");
    expect(machineRows).toHaveLength(1);
    expect(machineRows[0]!.version).toBe(2);
    expect(machineRows[0]!.value).toContain("WARN");
  });

  test("honours configured bucket and keyTemplate", async () => {
    const store = new Map<string, MemoryRow>();
    const client = clientWith(memoryStoreFetch(store));

    await saveHealthMemory(
      "test-machine",
      dummyReport,
      { enabled: true, bucket: "fleet-health", keyTemplate: "{bucket}/{target}" },
      client,
    );

    expect(store.size).toBe(1);
    expect([...store.values()][0]!.key).toBe("fleet-health/test-machine");
  });

  test("throws on a failed outcome so the dispatcher records it", async () => {
    const client = clientWith(failingFetch(400, "Missing required fields: key, value"));

    await expect(
      saveHealthMemory("test-machine", dummyReport, { enabled: true }, client),
    ).rejects.toThrow(/400/);
  });
});
