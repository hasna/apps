// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 1:
// runtime startup gates (src/server/runtime.ts). The fail-closed property under
// test: unauthenticated serving is permitted ONLY on a loopback bind AND the
// SQLite backend; every other combination requires auth and asserts it before
// starting. Also pins the env-var defaults/overrides for port, bind host,
// CORS origins and the rate limit.
import { afterEach, describe, expect, it } from "bun:test";
import {
  assertServeSafe,
  authRequired,
  corsOrigins,
  getBindHost,
  getPort,
  isLoopbackBind,
  rateLimitMax,
} from "../src/server/runtime.js";

const ENV_KEYS = [
  "HASNA_CONTROLS_PORT",
  "CONTROLS_PORT",
  "HASNA_CONTROLS_BIND_HOST",
  "CONTROLS_BIND_HOST",
  "HASNA_CONTROLS_CORS_ORIGINS",
  "CONTROLS_CORS_ORIGINS",
  "HASNA_CONTROLS_RATE_LIMIT",
  "CONTROLS_RATE_LIMIT",
  "HASNA_CONTROLS_DATABASE_URL",
  "CONTROLS_DATABASE_URL",
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("runtime: getPort", () => {
  it("defaults to 3482", () => {
    expect(getPort()).toBe(3482);
  });

  it("honors HASNA_CONTROLS_PORT and the CONTROLS_PORT alias, HASNA prefix winning", () => {
    process.env["HASNA_CONTROLS_PORT"] = "8080";
    expect(getPort()).toBe(8080);
    delete process.env["HASNA_CONTROLS_PORT"];
    process.env["CONTROLS_PORT"] = "9090";
    expect(getPort()).toBe(9090);
    process.env["HASNA_CONTROLS_PORT"] = "8081";
    expect(getPort()).toBe(8081);
  });

  it("falls back to the default for non-positive or non-numeric values", () => {
    for (const bad of ["0", "-5", "abc", "8080.5"]) {
      process.env["HASNA_CONTROLS_PORT"] = bad;
      expect(getPort(), `port env ${bad}`).toBe(3482);
    }
  });
});

describe("runtime: getBindHost and isLoopbackBind", () => {
  it("defaults to 127.0.0.1 and honors both env names", () => {
    expect(getBindHost()).toBe("127.0.0.1");
    process.env["HASNA_CONTROLS_BIND_HOST"] = "0.0.0.0";
    expect(getBindHost()).toBe("0.0.0.0");
    delete process.env["HASNA_CONTROLS_BIND_HOST"];
    process.env["CONTROLS_BIND_HOST"] = "::";
    expect(getBindHost()).toBe("::");
  });

  it("classifies loopback hosts (two-sided)", () => {
    expect(isLoopbackBind("127.0.0.1")).toBe(true);
    expect(isLoopbackBind("localhost")).toBe(true);
    expect(isLoopbackBind("::1")).toBe(true);
    expect(isLoopbackBind("0.0.0.0")).toBe(false);
    expect(isLoopbackBind("10.0.0.5")).toBe(false);
    expect(isLoopbackBind("192.168.1.10")).toBe(false);
  });

  it("default bind (unset env) is loopback", () => {
    expect(isLoopbackBind()).toBe(true);
  });
});

describe("runtime: corsOrigins", () => {
  it("defaults to an empty list", () => {
    expect(corsOrigins()).toEqual([]);
  });

  it("splits, trims and drops empty entries", () => {
    process.env["HASNA_CONTROLS_CORS_ORIGINS"] = " https://a.example.com , , https://b.example.com, ";
    expect(corsOrigins()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("honors the CONTROLS_CORS_ORIGINS alias", () => {
    process.env["CONTROLS_CORS_ORIGINS"] = "https://c.example.com";
    expect(corsOrigins()).toEqual(["https://c.example.com"]);
  });
});

describe("runtime: rateLimitMax", () => {
  it("defaults to 120 and honors a valid override", () => {
    expect(rateLimitMax()).toBe(120);
    process.env["HASNA_CONTROLS_RATE_LIMIT"] = "1";
    expect(rateLimitMax()).toBe(1);
    delete process.env["HASNA_CONTROLS_RATE_LIMIT"];
    process.env["CONTROLS_RATE_LIMIT"] = "25";
    expect(rateLimitMax()).toBe(25);
  });

  it("falls back to the default for non-positive or non-numeric values", () => {
    for (const bad of ["0", "-1", "lots", "12.5"]) {
      process.env["HASNA_CONTROLS_RATE_LIMIT"] = bad;
      expect(rateLimitMax(), `rate env ${bad}`).toBe(120);
    }
  });
});

describe("runtime: authRequired fail-closed matrix", () => {
  it("false only for loopback + SQLite", () => {
    // loopback + sqlite (nothing set)
    expect(authRequired()).toBe(false);
    // loopback + postgresql
    process.env["HASNA_CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    expect(authRequired()).toBe(true);
    delete process.env["HASNA_CONTROLS_DATABASE_URL"];
    // non-loopback + sqlite
    process.env["HASNA_CONTROLS_BIND_HOST"] = "0.0.0.0";
    expect(authRequired()).toBe(true);
    // non-loopback + postgresql
    process.env["HASNA_CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    expect(authRequired()).toBe(true);
  });
});

describe("runtime: assertServeSafe", () => {
  it("throws exactly when auth is required and no credentials are configured", () => {
    // loopback + sqlite + no creds: safe to serve open.
    expect(() => assertServeSafe(false)).not.toThrow();

    // non-loopback + sqlite + no creds: refuse.
    process.env["HASNA_CONTROLS_BIND_HOST"] = "0.0.0.0";
    expect(() => assertServeSafe(false)).toThrow(/Refusing to start/);
    expect(() => assertServeSafe(false)).toThrow(/non-loopback/);
    // non-loopback + creds configured: allowed.
    expect(() => assertServeSafe(true)).not.toThrow();

    // loopback + postgresql + no creds: refuse.
    delete process.env["HASNA_CONTROLS_BIND_HOST"];
    process.env["HASNA_CONTROLS_DATABASE_URL"] = "postgresql://placeholder-host/controls";
    expect(() => assertServeSafe(false)).toThrow(/Refusing to start/);
    expect(() => assertServeSafe(false)).toThrow(/PostgreSQL/);
    // loopback + postgresql + creds configured: allowed.
    expect(() => assertServeSafe(true)).not.toThrow();
  });
});
