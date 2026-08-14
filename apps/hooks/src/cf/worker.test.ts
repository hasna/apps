/**
 * Worker privacy lock-down tests.
 *
 * With HOOKS_API_KEY configured, every route except /health requires the key
 * (constant-time compare). Without the binding, reads stay open (OSS default).
 */

import { describe, expect, test } from "bun:test";
import worker, { type Env } from "./worker.js";
import { secureEqual } from "../lib/secure-compare.js";

function makeEnv(withKey: boolean): Env {
  const rows = [
    {
      id: "gitguard",
      name: "gitguard",
      version: "0.1.0",
      sha256: "a".repeat(64),
      source_type: "bundled",
      source_ref: null,
      installed_at: "2026-08-14T00:00:00.000Z",
      enabled: 1,
      last_verified_at: null,
    },
  ];
  const d1 = {
    prepare: () => ({
      bind: () => ({
        first: async () => rows[0],
        all: async () => ({ results: rows, success: true }),
        run: async () => ({}),
      }),
      first: async () => rows[0],
      all: async () => ({ results: rows, success: true }),
      run: async () => ({}),
    }),
  };
  const r2 = {
    get: async () => ({
      json: async () => ({
        manifest: { name: "gitguard", version: "0.1.0", events: ["PreToolUse"], script: "src/hook.ts" },
        script: "console.log('ok');",
      }),
    }),
    put: async () => ({}),
  };
  return { HOOKS_D1: d1 as never, HOOKS_R2: r2 as never, HOOKS_API_KEY: withKey ? "secret-key" : undefined };
}

function req(method: string, path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://hooks-registry.test${path}`, { method, headers });
}

describe("worker constant-time compare", () => {
  test("secureEqual distinguishes equal and differing values", () => {
    expect(secureEqual("secret-key", "secret-key")).toBe(true);
    expect(secureEqual("secret-key", "secret-keY")).toBe(false);
    expect(secureEqual("secret-key", "secret-key-extra")).toBe(false);
    expect(secureEqual("", "")).toBe(true);
    expect(secureEqual("a", "")).toBe(false);
  });

  test("different lengths do not leak through an early content match", () => {
    expect(secureEqual("same-prefix", "same-prefix-longer")).toBe(false);
    expect(secureEqual("same-prefix-longer", "same-prefix")).toBe(false);
  });
});

describe("worker auth with HOOKS_API_KEY set", () => {
  const env = makeEnv(true);

  test("/health is open without a key", async () => {
    const res = await worker.fetch(req("GET", "/health"), env);
    expect(res.status).toBe(200);
  });

  test("catalog GET is 401 without the key and 200 with X-API-Key", async () => {
    const denied = await worker.fetch(req("GET", "/api/v1/catalog"), env);
    expect(denied.status).toBe(401);
    const allowed = await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "secret-key" }), env);
    expect(allowed.status).toBe(200);
  });

  test("artifact GET is 401 without the key and 200 with X-API-Key", async () => {
    const denied = await worker.fetch(req("GET", "/api/v1/hooks/gitguard/0.1.0"), env);
    expect(denied.status).toBe(401);
    const allowed = await worker.fetch(
      req("GET", "/api/v1/hooks/gitguard/0.1.0", { "x-api-key": "secret-key" }), env);
    expect(allowed.status).toBe(200);
  });

  test("lock GET is 401 without the key and 200 with X-API-Key", async () => {
    const denied = await worker.fetch(req("GET", "/api/v1/lock"), env);
    expect(denied.status).toBe(401);
    const allowed = await worker.fetch(req("GET", "/api/v1/lock", { "x-api-key": "secret-key" }), env);
    expect(allowed.status).toBe(200);
  });

  test("publish PUT is 401 without the key and 200 with X-API-Key", async () => {
    const denied = await worker.fetch(req("PUT", "/api/v1/hooks"), env);
    expect(denied.status).toBe(401);
    const allowed = await worker.fetch(
      new Request("https://hooks-registry.test/api/v1/hooks", {
        method: "PUT",
        headers: { "x-api-key": "secret-key", "content-type": "application/json" },
        body: JSON.stringify({
          manifest: { name: "gitguard", version: "0.1.0", events: ["PreToolUse"], script: "src/hook.ts" },
          script: "console.log('ok');",
        }),
      }), env);
    expect(allowed.status).toBe(200);
  });

  test("a wrong key is rejected on every protected route", async () => {
    const res = await worker.fetch(req("GET", "/api/v1/catalog", { "x-api-key": "wrong" }), env);
    expect(res.status).toBe(401);
  });

  test("Bearer key is accepted on protected routes", async () => {
    const res = await worker.fetch(
      req("GET", "/api/v1/catalog", { authorization: "Bearer secret-key" }), env);
    expect(res.status).toBe(200);
  });
});

describe("worker without HOOKS_API_KEY (OSS default)", () => {
  const env = makeEnv(false);

  test("reads stay open", async () => {
    const catalog = await worker.fetch(req("GET", "/api/v1/catalog"), env);
    expect(catalog.status).toBe(200);
    const lock = await worker.fetch(req("GET", "/api/v1/lock"), env);
    expect(lock.status).toBe(200);
  });

  test("publish still requires a key", async () => {
    const res = await worker.fetch(req("PUT", "/api/v1/hooks"), env);
    expect(res.status).toBe(401);
  });
});
