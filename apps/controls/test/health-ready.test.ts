// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 4:
// health endpoints (src/server/health.ts) with a real live DB handle and a
// throwing DB handle. The throwing side uses the app's real fail-closed path:
// with a DATABASE_URL configured, getDatabase() refuses to fall back to
// ephemeral SQLite, so /ready reports unavailable. No live PostgreSQL is
// contacted anywhere in this file — the DSN value is presence-only.
import { afterEach, describe, expect, it } from "bun:test";
import { createApp } from "../src/server/app.js";
import { closeDatabase, getDatabase, resetDatabaseCache } from "../src/db/database.js";
import { healthPayload, readyPayload } from "../src/server/health.js";

const ENV_KEYS = [
  "HASNA_CONTROLS_DB_PATH",
  "CONTROLS_DB_PATH",
  "HASNA_CONTROLS_DATABASE_URL",
  "CONTROLS_DATABASE_URL",
  "HASNA_CONTROLS_API_CREDENTIALS",
  "HASNA_CONTROLS_API_KEY",
  "HASNA_CONTROLS_BIND_HOST",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  closeDatabase();
  resetDatabaseCache();
});

describe("health: readyPayload with a live database handle", () => {
  it("reports ready with migrations applied", () => {
    process.env["HASNA_CONTROLS_DB_PATH"] = ":memory:";
    getDatabase(); // prime the cached live handle (in-memory SQLite, schema + ledger applied)
    const { ready, body } = readyPayload();
    expect(ready).toBe(true);
    expect(body.status).toBe("ready");
    expect(body.migrations_applied).toBeGreaterThan(0);
  });

  it("reports unavailable when the database handle cannot be opened (fail-closed, two-sided)", () => {
    // A configured DATABASE_URL selects PostgreSQL; getDatabase() refuses to
    // serve from volatile in-memory SQLite and throws — readyPayload catches it.
    process.env["HASNA_CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    const { ready, body } = readyPayload();
    expect(ready).toBe(false);
    expect(body.status).toBe("unavailable");
    expect(body).not.toHaveProperty("migrations_applied");
  });

  it("GET /ready answers 200 ready and 503 unavailable over HTTP (two-sided)", async () => {
    const app = createApp();

    process.env["HASNA_CONTROLS_DB_PATH"] = ":memory:";
    const ok = await app.request("/ready");
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ready");

    closeDatabase();
    resetDatabaseCache();
    process.env["HASNA_CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    const down = await app.request("/ready");
    expect(down.status).toBe(503);
    expect((await down.json()).status).toBe("unavailable");
  });
});

describe("health: healthPayload contract", () => {
  it("reports ok with a version and the sqlite backend", () => {
    const payload = healthPayload();
    expect(payload.status).toBe("ok");
    expect(typeof payload.version).toBe("string");
    expect(payload.version.length).toBeGreaterThan(0);
    expect(payload.backend).toBe("sqlite");
  });
});
