import { afterEach, describe, expect, it } from "bun:test";
import { buildApp } from "../src/server/app.js";
import { healthPayload, readyPayload, versionPayload } from "../src/server/health.js";
import { parseListQuery } from "../src/server/list-query.js";
import { APP_VERSION } from "../src/version.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

/**
 * Direct tests for the /v1 query parsing (src/server/list-query.ts) and the
 * system payloads (src/server/health.ts). These are exercised end-to-end by
 * the route tests, but their failure modes — NaN limits, unknown filter keys,
 * ready=false with a broken store — deserve pinned unit coverage.
 */

let dbPath: string;

afterEach(() => {
  if (dbPath) cleanupTestDatabase(dbPath);
  dbPath = undefined as never;
  delete process.env["HASNA_ACCESS_DATABASE_URL"];
  delete process.env["ACCESS_DATABASE_URL"];
});

/** A minimal context exposing only the query lookup parseListQuery uses. */
function contextFor(query: Record<string, string>) {
  const c = { req: { query: (key: string) => query[key] } } as unknown as Parameters<typeof parseListQuery>[0];
  return parseListQuery(c, ["status", "kind"]);
}

describe("parseListQuery", () => {
  it("returns an empty query for no parameters", () => {
    expect(contextFor({})).toEqual({});
  });

  it("parses numeric limit and offset", () => {
    expect(contextFor({ limit: "25", offset: "10" })).toEqual({ limit: 25, offset: 10 });
  });

  it("keeps only the allowlisted filter keys", () => {
    expect(contextFor({ status: "active", kind: "agent" })).toEqual({ status: "active", kind: "agent" });
  });

  it("drops unknown filter keys instead of forwarding them", () => {
    expect(contextFor({ evil: "1", limit: "5" })).toEqual({ limit: 5 });
  });

  it("propagates a NaN limit/offset to the downstream clamps rather than crashing", () => {
    // parseListQuery does not itself validate numbers; the registry's clampLimit/
    // clampOffset normalizes NaN later. This pins the raw parse contract so a
    // future "fix" cannot silently change what the clamps receive.
    const parsed = contextFor({ limit: "abc", offset: "xyz" });
    expect(Number.isNaN(parsed.limit)).toBe(true);
    expect(Number.isNaN(parsed.offset)).toBe(true);
  });

  it("forwards empty-string filter values for downstream normalization", () => {
    // parseListQuery forwards whatever the query string carried; the registry's
    // optStr treats empty values as absent downstream. Pins that contract.
    expect(contextFor({ status: "", kind: "  " })).toEqual({ status: "", kind: "  " });
  });

  it("uses the query string verbatim for non-numeric limit shapes", () => {
    expect(contextFor({ limit: "0" })).toEqual({ limit: 0 });
    expect(contextFor({ limit: "-5" })).toEqual({ limit: -5 });
  });
});

describe("healthPayload / versionPayload", () => {
  it("reports the exact local payload — no extra keys", () => {
    expect(healthPayload()).toEqual({ status: "ok", version: APP_VERSION, mode: "local" });
  });

  it("reports cloud mode when a DATABASE_URL is configured", () => {
    process.env["HASNA_ACCESS_DATABASE_URL"] = "postgres://x";
    expect(healthPayload()).toEqual({ status: "ok", version: APP_VERSION, mode: "cloud" });
    expect(versionPayload()).toEqual({ status: "ok", version: APP_VERSION, mode: "cloud" });
  });

  it("version payload carries the same shape as health", () => {
    expect(versionPayload()).toEqual(healthPayload());
  });
});

describe("readyPayload", () => {
  it("is ready when the local store answers a SELECT 1", () => {
    dbPath = useTestDatabase("access-health-ready");
    expect(readyPayload()).toEqual({ ready: true, status: "ready" });
  });

  it("is NOT ready with a reason when the store cannot be opened", () => {
    // Cloud mode in this local build cannot connect; getDatabase() throws and
    // readyPayload must report unavailable with the underlying reason — never
    // a crash and never a false ready.
    process.env["HASNA_ACCESS_DATABASE_URL"] = "postgres://unreachable";
    const payload = readyPayload();
    expect(payload.ready).toBe(false);
    expect(payload.status).toBe("unavailable");
    expect(typeof payload.reason).toBe("string");
    expect(payload.reason!.length).toBeGreaterThan(0);
  });
});

describe("/health and /ready HTTP mapping", () => {
  it("serves /health 200 with the exact payload and /ready 200 when ready", async () => {
    dbPath = useTestDatabase("access-health-http");
    const app = buildApp();

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", version: APP_VERSION, mode: "local" });

    const ready = await app.request("/ready");
    expect(ready.status).toBe(200);
    // The route body is {status} (+ optional reason), not the full readiness payload.
    expect(await ready.json()).toEqual({ status: "ready" });
  });

  it("maps an unavailable store to /ready 503 with a bounded failure body", async () => {
    process.env["HASNA_ACCESS_DATABASE_URL"] = "postgres://unreachable";
    const app = buildApp();

    const ready = await app.request("/ready");
    expect(ready.status).toBe(503);
    const body = (await ready.json()) as Record<string, unknown>;
    expect(body.status).toBe("unavailable");
    expect(String(body.reason).length).toBeGreaterThan(0);
  });
});
