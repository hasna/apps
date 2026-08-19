/**
 * Test gap coverage for src/server/auth.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The API auth module had no direct sibling test (the server suite covers it
 * through routes). These tests pin the unit contract: configured-token
 * precedence, bearer/x-logs-token acceptance, the trusted-local loopback
 * rules (host, x-forwarded-host chain, origin), browser-token fallback on the
 * browser-write paths, and the local-open env parsing.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createTestDb } from "../db/index.ts";
import { createBrowserIngestToken } from "../lib/browser-ingest-tokens.ts";
import {
  authorizeLogIngest,
  getConfiguredApiToken,
  isApiRequestAuthorized,
  isLocalOpenModeEnabled,
  isTrustedLocalRequest,
  requireApiToken,
  requireApiTokenOrBrowserIngest,
} from "./auth.ts";

const ENV_KEYS = [
  "HASNA_LOGS_API_TOKEN",
  "LOGS_API_TOKEN",
  "HASNA_LOGS_LOCAL_OPEN",
  "LOGS_LOCAL_OPEN",
];
const ORIGINAL = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Harness: call a context-dependent predicate and return its verdict as JSON. */
function probeHarness(
  probe: (c: Parameters<typeof isTrustedLocalRequest>[0]) => unknown,
) {
  const app = new Hono();
  app.all("/probe", (c) => c.json({ verdict: probe(c) }));
  return app;
}

const REQUEST_OPTS = {
  method: "GET",
  headers: { host: "localhost:3000" },
};

describe("getConfiguredApiToken", () => {
  it("prefers HASNA_LOGS_API_TOKEN over LOGS_API_TOKEN and trims", () => {
    expect(getConfiguredApiToken()).toBeNull();
    process.env.HASNA_LOGS_API_TOKEN = "  hasna-token  ";
    process.env.LOGS_API_TOKEN = "legacy" + "-token";
    expect(getConfiguredApiToken()).toBe("hasna-token");
    delete process.env.HASNA_LOGS_API_TOKEN;
    expect(getConfiguredApiToken()).toBe("legacy-token");
    process.env.LOGS_API_TOKEN = "   ";
    expect(getConfiguredApiToken()).toBeNull();
  });
});

describe("isApiRequestAuthorized", () => {
  it("rejects without a token when local-open is off, even on loopback", async () => {
    const app = probeHarness((c) => isApiRequestAuthorized(c));
    const res = await app.request("/probe", REQUEST_OPTS);
    expect(((await res.json()) as { verdict: unknown }).verdict).toBe(false);
  });

  it("accepts bearer and x-logs-token headers, case-insensitively", async () => {
    process.env.HASNA_LOGS_API_TOKEN = "correct" + "-token";
    const app = probeHarness((c) => isApiRequestAuthorized(c));
    const bearer = await app.request("/probe", {
      method: "GET",
      headers: { authorization: "Bearer correct-token" },
    });
    expect(((await bearer.json()) as { verdict: unknown }).verdict).toBe(true);
    const header = await app.request("/probe", {
      method: "GET",
      headers: { "x-logs-token": "correct-token" },
    });
    expect(((await header.json()) as { verdict: unknown }).verdict).toBe(true);
    const wrong = await app.request("/probe", {
      method: "GET",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(((await wrong.json()) as { verdict: unknown }).verdict).toBe(false);
    // Length mismatch must fail (constant-time compare rejects early).
    const longer = await app.request("/probe", {
      method: "GET",
      headers: { authorization: "Bearer correct-token-extra" },
    });
    expect(((await longer.json()) as { verdict: unknown }).verdict).toBe(false);
  });

  it("allows loopback only when local-open mode is explicitly enabled", async () => {
    const app = probeHarness((c) => isApiRequestAuthorized(c));
    process.env.HASNA_LOGS_LOCAL_OPEN = "1";
    const res = await app.request("/probe", REQUEST_OPTS);
    expect(((await res.json()) as { verdict: unknown }).verdict).toBe(true);
    process.env.HASNA_LOGS_LOCAL_OPEN = "0";
    const off = await app.request("/probe", REQUEST_OPTS);
    expect(((await off.json()) as { verdict: unknown }).verdict).toBe(false);
  });
});

describe("isTrustedLocalRequest", () => {
  it("accepts localhost, 127.0.0.1, and ::1 hosts", async () => {
    const app = probeHarness((c) => isTrustedLocalRequest(c));
    for (const host of ["localhost", "127.0.0.1", "::1", "localhost:3000"]) {
      const res = await app.request("/probe", {
        method: "GET",
        headers: { host },
      });
      expect(((await res.json()) as { verdict: unknown }).verdict).toBe(true);
    }
  });

  it("rejects remote hosts and any non-local member of the x-forwarded-host chain", async () => {
    const app = probeHarness((c) => isTrustedLocalRequest(c));
    const remote = await app.request("/probe", {
      method: "GET",
      headers: { host: "logs.example.com" },
    });
    expect(((await remote.json()) as { verdict: unknown }).verdict).toBe(false);

    const chain = await app.request("/probe", {
      method: "GET",
      headers: {
        host: "localhost",
        "x-forwarded-host": "localhost, logs.example.com",
      },
    });
    expect(((await chain.json()) as { verdict: unknown }).verdict).toBe(false);

    const allLocal = await app.request("/probe", {
      method: "GET",
      headers: { host: "localhost", "x-forwarded-host": "127.0.0.1, [::1]" },
    });
    expect(((await allLocal.json()) as { verdict: unknown }).verdict).toBe(true);
  });

  it("rejects a remote origin and accepts a local or missing origin", async () => {
    const app = probeHarness((c) => isTrustedLocalRequest(c));
    const remoteOrigin = await app.request("/probe", {
      method: "GET",
      headers: { host: "localhost", origin: "https://logs.example.com" },
    });
    expect(((await remoteOrigin.json()) as { verdict: unknown }).verdict).toBe(false);
    const localOrigin = await app.request("/probe", {
      method: "GET",
      headers: { host: "localhost", origin: "http://localhost:5173" },
    });
    expect(((await localOrigin.json()) as { verdict: unknown }).verdict).toBe(true);
    const noOrigin = await app.request("/probe", {
      method: "GET",
      headers: { host: "localhost" },
    });
    expect(((await noOrigin.json()) as { verdict: unknown }).verdict).toBe(true);
    const badOrigin = await app.request("/probe", {
      method: "GET",
      headers: { host: "localhost", origin: "not a url" },
    });
    expect(((await badOrigin.json()) as { verdict: unknown }).verdict).toBe(false);
  });
});

describe("isLocalOpenModeEnabled", () => {
  it("accepts the documented true values and rejects everything else", () => {
    for (const value of ["1", "true", "yes", "on", " TRUE "]) {
      process.env.HASNA_LOGS_LOCAL_OPEN = value;
      expect(isLocalOpenModeEnabled()).toBe(true);
    }
    for (const value of ["0", "false", "no", "off", "", "2"]) {
      process.env.HASNA_LOGS_LOCAL_OPEN = value;
      expect(isLocalOpenModeEnabled()).toBe(false);
    }
    delete process.env.HASNA_LOGS_LOCAL_OPEN;
    process.env.LOGS_LOCAL_OPEN = "on";
    expect(isLocalOpenModeEnabled()).toBe(true);
    delete process.env.LOGS_LOCAL_OPEN;
  });
});

describe("authorizeLogIngest", () => {
  it("grants trusted-local only on loopback with local-open, else null without a token", async () => {
    const db = createTestDb();
    const app = probeHarness((c) => authorizeLogIngest(db, c));
    const closed = await app.request("/probe", REQUEST_OPTS);
    expect(((await closed.json()) as { verdict: unknown }).verdict).toBeNull();
    process.env.HASNA_LOGS_LOCAL_OPEN = "1";
    const open = await app.request("/probe", REQUEST_OPTS);
    expect(((await open.json()) as { verdict: unknown }).verdict).toEqual({ kind: "trusted-local" });
  });

  it("prefers api-token and falls back to browser-token on browser writes", async () => {
    process.env.HASNA_LOGS_API_TOKEN = "api" + "-token";
    const db = createTestDb();
    db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(
      "proj-1",
      "proj-1",
    );
    const created = createBrowserIngestToken(db, "proj-1");
    const app = probeHarness((c) => authorizeLogIngest(db, c));

    const api = await app.request("/probe", {
      method: "POST",
      headers: { authorization: "Bearer api-token" },
    });
    expect(((await api.json()) as { verdict: unknown }).verdict).toEqual({ kind: "api-token" });

    const browser = await app.request("/probe", {
      method: "POST",
      headers: {
        "x-logs-browser-token": created.token,
        origin: "https://x.example",
      },
    });
    const verdict = ((await browser.json()) as { verdict: unknown }).verdict as { kind: string };
    expect(verdict.kind).toBe("browser-token");

    const invalid = await app.request("/probe", {
      method: "POST",
      headers: { "x-logs-browser-token": "olb_zzzz" },
    });
    expect(((await invalid.json()) as { verdict: unknown }).verdict).toBeNull();
  });
});

describe("middleware gates", () => {
  it("requireApiToken returns 401 for unauthorized requests", async () => {
    const app = new Hono();
    app.use("/api/*", requireApiToken);
    app.get("/api/ping", (c) => c.text("pong"));
    const res = await app.request("/api/ping");
    expect(res.status).toBe(401);
    process.env.HASNA_LOGS_API_TOKEN = "t";
    const ok = await app.request("/api/ping", {
      method: "GET",
      headers: { authorization: "Bearer t" },
    });
    expect(ok.status).toBe(200);
  });

  it("requireApiTokenOrBrowserIngest accepts a valid browser token on a browser write", async () => {
    const db = createTestDb();
    db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(
      "proj-1",
      "proj-1",
    );
    const created = createBrowserIngestToken(db, "proj-1");
    const app = new Hono();
    app.use("/api/*", requireApiTokenOrBrowserIngest(db));
    app.post("/api/logs", (c) => c.text("ingested"));
    const res = await app.request("/api/logs", {
      method: "POST",
      headers: { "x-logs-browser-token": created.token, origin: "https://x.example" },
    });
    expect(res.status).toBe(200);
    const denied = await app.request("/api/logs", {
      method: "POST",
      headers: { "x-logs-browser-token": "olb_invalid" },
    });
    expect(denied.status).toBe(401);
  });
});
