import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  SERVE_TOKEN_ENV,
  SERVE_TOKEN_FILE,
  SERVE_UNAUTHORIZED_CODE,
  isServeAuthorized,
  presentedToken,
  readServeToken,
  requiresServeAuth,
  resolveServeToken,
  serveTokenPath,
  tokenMatches,
  unauthorizedPayload,
} from "./serve-auth.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "connectors-serve-auth-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("serve token resolution", () => {
  test("explicit token wins over env and file", () => {
    writeFileSync(join(home, SERVE_TOKEN_FILE), "from-file\n");
    const resolved = resolveServeToken({ token: "explicit", env: { [SERVE_TOKEN_ENV]: "from-env" }, home });
    expect(resolved).toEqual({ token: "explicit", source: "explicit", path: null });
  });

  test("env wins over the file", () => {
    writeFileSync(join(home, SERVE_TOKEN_FILE), "from-file\n");
    const resolved = resolveServeToken({ env: { [SERVE_TOKEN_ENV]: "  from-env  " }, home });
    expect(resolved).toEqual({ token: "from-env", source: "env", path: null });
  });

  test("the file is read when the env is unset", () => {
    writeFileSync(join(home, SERVE_TOKEN_FILE), "from-file\n");
    const resolved = resolveServeToken({ env: {}, home });
    expect(resolved.token).toBe("from-file");
    expect(resolved.source).toBe("file");
    expect(resolved.path).toBe(serveTokenPath(home));
  });

  test("a blank file counts as absent and is regenerated", () => {
    writeFileSync(join(home, SERVE_TOKEN_FILE), "   \n");
    const resolved = resolveServeToken({ env: {}, home });
    expect(resolved.source).toBe("generated");
    expect(resolved.token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("generates a 256-bit token, writes it owner-only, and reuses it on the next start", () => {
    const first = resolveServeToken({ env: {}, home });
    expect(first.source).toBe("generated");
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    const path = serveTokenPath(home);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf-8").trim()).toBe(first.token);

    const second = resolveServeToken({ env: {}, home });
    expect(second).toEqual({ token: first.token, source: "file", path });
  });

  test("readServeToken never creates a file", () => {
    expect(readServeToken({}, home)).toBeNull();
    expect(existsSync(serveTokenPath(home))).toBe(false);
    expect(readServeToken({ [SERVE_TOKEN_ENV]: "x" }, home)).toEqual({ token: "x", source: "env", path: null });
  });
});

describe("request gate", () => {
  test("public routes: /health, OAuth browser routes, CORS preflights", () => {
    expect(requiresServeAuth("/health", "GET")).toBe(false);
    expect(requiresServeAuth("/oauth/github/start", "GET")).toBe(false);
    expect(requiresServeAuth("/oauth/github/callback", "GET")).toBe(false);
    expect(requiresServeAuth("/api/export", "OPTIONS")).toBe(false);
  });

  test("gated routes: every /api/* route and /mcp", () => {
    expect(requiresServeAuth("/api/export", "GET")).toBe(true);
    expect(requiresServeAuth("/api/import", "POST")).toBe(true);
    expect(requiresServeAuth("/api/connectors", "GET")).toBe(true);
    expect(requiresServeAuth("/api/connectors/github/auth", "POST")).toBe(true);
    expect(requiresServeAuth("/mcp", "POST")).toBe(true);
    expect(requiresServeAuth("/oauth/github/other", "GET")).toBe(true);
    expect(requiresServeAuth("/anything-else", "GET")).toBe(true);
  });

  test("accepts Authorization: Bearer and X-Connectors-Token, constant-time", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const bearer = new Request("http://127.0.0.1:1/api/export", { headers: { Authorization: `Bearer ${token}` } });
    const header = new Request("http://127.0.0.1:1/api/export", { headers: { "X-Connectors-Token": token } });
    const wrong = new Request("http://127.0.0.1:1/api/export", { headers: { Authorization: "Bearer nope" } });
    const sameLengthWrong = new Request("http://127.0.0.1:1/api/export", {
      headers: { Authorization: `Bearer ${"f".repeat(token.length)}` },
    });
    const none = new Request("http://127.0.0.1:1/api/export");
    const basic = new Request("http://127.0.0.1:1/api/export", { headers: { Authorization: "Basic abc" } });

    expect(presentedToken(bearer)).toBe(token);
    expect(presentedToken(header)).toBe(token);
    expect(presentedToken(none)).toBeNull();
    expect(presentedToken(basic)).toBeNull();

    expect(isServeAuthorized(bearer, token)).toBe(true);
    expect(isServeAuthorized(header, token)).toBe(true);
    expect(isServeAuthorized(wrong, token)).toBe(false);
    expect(isServeAuthorized(sameLengthWrong, token)).toBe(false);
    expect(isServeAuthorized(none, token)).toBe(false);
    expect(tokenMatches(null, token)).toBe(false);
    expect(tokenMatches("", token)).toBe(false);
  });

  test("public routes pass without a token; the payload names sources, never a value", () => {
    const health = new Request("http://127.0.0.1:1/health");
    expect(isServeAuthorized(health, "secret-token")).toBe(true);
    const payload = unauthorizedPayload();
    expect(payload.error.startsWith(`${SERVE_UNAUTHORIZED_CODE}:`)).toBe(true);
    expect(payload.hint).toContain(SERVE_TOKEN_ENV);
    expect(payload.hint).toContain(SERVE_TOKEN_FILE);
    expect(JSON.stringify(payload)).not.toContain("secret-token");
  });
});
