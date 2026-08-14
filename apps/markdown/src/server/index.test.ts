import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseServerCliArgs, getServerHelpText, resolveServerPort, createServer } from "./index.js";

describe("server CLI flags", () => {
  test("prints help and exits when --help is used", () => {
    const out: string[] = [];
    const parsed = parseServerCliArgs(["--help"], (msg) => out.push(msg));

    expect(parsed.handled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(getServerHelpText());
    expect(out[0]).toContain("Usage: markdown-serve [options]");
  });

  test("prints version and exits when --version is used", () => {
    const out: string[] = [];
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const parsed = parseServerCliArgs(["--version"], (msg) => out.push(msg));

    expect(parsed.handled).toBe(true);
    expect(out).toEqual([pkg.version]);
  });

  test("parses --port value", () => {
    const parsed = parseServerCliArgs(["--port", "8080"]);

    expect(parsed.handled).toBe(false);
    expect(parsed.port).toBe(8080);
  });

  test("parses --port=value", () => {
    const parsed = parseServerCliArgs(["--port=9090"]);

    expect(parsed.handled).toBe(false);
    expect(parsed.port).toBe(9090);
  });

  test("resolves default server port", () => {
    expect(resolveServerPort([], {})).toBe(7070);
  });

  test("resolves OMP_PORT when CLI port is omitted", () => {
    expect(resolveServerPort([], { OMP_PORT: "9091" })).toBe(9091);
  });

  test("CLI port takes precedence over OMP_PORT", () => {
    expect(resolveServerPort(["--port", "8080"], { OMP_PORT: "9091" })).toBe(8080);
  });

  test("throws on invalid port", () => {
    expect(() => parseServerCliArgs(["--port", "abc"]))
      .toThrow("Invalid port: abc");
  });

  test("throws on invalid OMP_PORT", () => {
    expect(() => resolveServerPort([], { OMP_PORT: "123abc" }))
      .toThrow("Invalid port: 123abc");
  });

  test("throws on empty OMP_PORT", () => {
    expect(() => resolveServerPort([], { OMP_PORT: "" }))
      .toThrow("Invalid port:");
  });

  test("throws on missing port value", () => {
    expect(() => parseServerCliArgs(["--port"]))
      .toThrow("Missing value for --port");
  });
});

describe("server HTTP API", () => {
  test("returns 400 for malformed JSON request bodies", async () => {
    const server = createServer(0);

    try {
      const response = await fetch(`http://localhost:${server.port}/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    } finally {
      server.stop(true);
    }
  });
});
