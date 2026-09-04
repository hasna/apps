import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import {
  assertHeadlessOutboundUrl,
  getHeadlessBoundaryManifest,
  isAllowedLocalApiUrl,
  scanSourceForForbiddenWebPatterns,
  FORBIDDEN_WEB_PATTERNS,
} from "./headless-boundaries.js";

const textExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".html", ".css"]);

function walkSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
      files.push(...walkSourceFiles(full));
      continue;
    }
    if (textExtensions.has(extname(full))) files.push(full);
  }
  return files;
}

describe("headless boundary manifest", () => {
  it("declares agent-native local-first surfaces", () => {
    const manifest = getHeadlessBoundaryManifest();
    expect(manifest.agent_native).toBe(true);
    expect(manifest.hosted_auth).toBe(false);
    expect(manifest.hosted_mutation).toBe(false);
    expect(manifest.primary_surfaces).toEqual(["cli", "mcp", "sdk"]);
    expect(manifest.forbidden_remote_hosts).toContain("todos.md");
  });
});

describe("isAllowedLocalApiUrl", () => {
  it("allows relative /api paths", () => {
    expect(isAllowedLocalApiUrl("/api/tasks")).toBe(true);
    expect(isAllowedLocalApiUrl("/api/stats")).toBe(true);
  });

  it("allows localhost API URLs", () => {
    expect(isAllowedLocalApiUrl("http://127.0.0.1:19427/api/tasks")).toBe(true);
    expect(isAllowedLocalApiUrl("http://localhost:19427/api/stats", 19427)).toBe(true);
  });

  it("rejects remote hosted URLs", () => {
    expect(isAllowedLocalApiUrl("https://todos.md/api/tasks")).toBe(false);
    expect(isAllowedLocalApiUrl("https://example.com/api/tasks")).toBe(false);
  });
});

describe("assertHeadlessOutboundUrl", () => {
  it("allows local and documentation URLs", () => {
    expect(() => assertHeadlessOutboundUrl("http://127.0.0.1:19427/api/tasks")).not.toThrow();
    expect(() => assertHeadlessOutboundUrl("https://github.com/hasna/todos")).not.toThrow();
  });

  it("blocks hosted platform URLs", () => {
    expect(() => assertHeadlessOutboundUrl("https://todos.md/api/tasks")).toThrow(/forbidden host/i);
    expect(() => assertHeadlessOutboundUrl("https://www.todos.md/v1/tasks")).toThrow(/forbidden host/i);
    expect(() => assertHeadlessOutboundUrl("@hasnastudio/platform-todos-cli")).toThrow(/boundary violation/i);
  });
});

describe("server web surface regression", () => {
  it("server code must not proxy to platform-todos or todos.md", () => {
    const serverRoot = join(import.meta.dir, "..", "server");
    const violations: string[] = [];
    for (const file of walkSourceFiles(serverRoot)) {
      const source = readFileSync(file, "utf8");
      violations.push(...scanSourceForForbiddenWebPatterns(file, source));
      if (/\bfetch\s*\(\s*[`'"]https?:\/\//.test(source)) {
        violations.push(`${file}: server performs outbound HTTP fetch`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("server must not define sign-in or OAuth routes", () => {
    const routesSrc = readFileSync(join(import.meta.dir, "..", "server", "routes.ts"), "utf8");
    const serveSrc = readFileSync(join(import.meta.dir, "..", "server", "serve.ts"), "utf8");
    const combined = routesSrc + serveSrc;
    expect(/\/sign-?in|\/oauth|\/login.*session/i.test(combined)).toBe(false);
  });
});
