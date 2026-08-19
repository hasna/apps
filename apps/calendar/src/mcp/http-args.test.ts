import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_MCP_HTTP_PORT, isHttpMode, parseHttpArgv, resolveMcpHttpPort } from "./http.js";

const SAVED = { port: process.env.MCP_HTTP_PORT, mode: process.env.MCP_HTTP };

afterEach(() => {
  if (SAVED.port === undefined) delete process.env.MCP_HTTP_PORT;
  else process.env.MCP_HTTP_PORT = SAVED.port;
  if (SAVED.mode === undefined) delete process.env.MCP_HTTP;
  else process.env.MCP_HTTP = SAVED.mode;
});

describe("resolveMcpHttpPort", () => {
  test("an explicit port wins", () => {
    expect(resolveMcpHttpPort(9900)).toBe(9900);
  });

  test("an explicit NaN does not count and falls through to env then default", () => {
    process.env.MCP_HTTP_PORT = "8801";
    expect(resolveMcpHttpPort(Number.NaN)).toBe(8801);
    delete process.env.MCP_HTTP_PORT;
    expect(resolveMcpHttpPort(Number.NaN)).toBe(DEFAULT_MCP_HTTP_PORT);
  });

  test("reads the MCP_HTTP_PORT env var", () => {
    process.env.MCP_HTTP_PORT = "8811";
    expect(resolveMcpHttpPort()).toBe(8811);
  });

  test("an unparseable env var falls back to the default", () => {
    process.env.MCP_HTTP_PORT = "not-a-port";
    expect(resolveMcpHttpPort()).toBe(DEFAULT_MCP_HTTP_PORT);
  });

  test("parseInt-style env values truncate instead of failing (documented quirk)", () => {
    // resolveMcpHttpPort uses parseInt, so these resolve to a port rather than
    // erroring — pin the exact behavior so a stricter parser is caught.
    process.env.MCP_HTTP_PORT = "12x";
    expect(resolveMcpHttpPort()).toBe(12);
    process.env.MCP_HTTP_PORT = "1.5";
    expect(resolveMcpHttpPort()).toBe(1);
    process.env.MCP_HTTP_PORT = "0";
    expect(resolveMcpHttpPort()).toBe(0);
  });

  test("defaults to 8803", () => {
    delete process.env.MCP_HTTP_PORT;
    expect(resolveMcpHttpPort()).toBe(DEFAULT_MCP_HTTP_PORT);
  });
});

describe("isHttpMode", () => {
  test("the --http argv flag selects http mode", () => {
    expect(isHttpMode(["calendar-mcp", "--http"])).toBe(true);
    expect(isHttpMode(["calendar-mcp"])).toBe(false);
  });

  test("MCP_HTTP=1 selects http mode", () => {
    process.env.MCP_HTTP = "1";
    expect(isHttpMode([])).toBe(true);
  });

  test("MCP_HTTP=0 does not", () => {
    process.env.MCP_HTTP = "0";
    expect(isHttpMode([])).toBe(false);
  });
});

describe("parseHttpArgv", () => {
  test("parses --port N alongside --http", () => {
    expect(parseHttpArgv(["calendar-mcp", "--http", "--port", "8877"])).toEqual({ http: true, port: 8877 });
  });

  test("a missing --port value yields no port", () => {
    expect(parseHttpArgv(["calendar-mcp", "--port"])).toEqual({ http: false, port: undefined });
  });

  test("a non-numeric --port value yields NaN (the resolver later falls back)", () => {
    const result = parseHttpArgv(["calendar-mcp", "--port", "abc"]);
    expect(result.http).toBe(false);
    expect(Number.isNaN(result.port)).toBe(true);
  });
});
