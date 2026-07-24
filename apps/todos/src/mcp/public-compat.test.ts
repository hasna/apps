import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFocus } from "./index.js";
import { handleMcpHttpRequest } from "./http.js";

const REPO_ROOT = join(import.meta.dir, "../..");
const originalMode = process.env.HASNA_TODOS_STORAGE_MODE;
const originalFallback = process.env.TODOS_STORAGE_MODE;

afterEach(() => {
  if (originalMode === undefined) delete process.env.HASNA_TODOS_STORAGE_MODE;
  else process.env.HASNA_TODOS_STORAGE_MODE = originalMode;
  if (originalFallback === undefined) delete process.env.TODOS_STORAGE_MODE;
  else process.env.TODOS_STORAGE_MODE = originalFallback;
});

describe("MCP public compatibility", () => {
  test("applyFocus preserves the base name and arity and guards hostile params before runtime", () => {
    expect(applyFocus.name).toBe("applyFocus");
    expect(applyFocus.length).toBe(2);
    process.env.HASNA_TODOS_STORAGE_MODE = "remote";
    process.env.TODOS_STORAGE_MODE = "remote";
    let reads = 0;
    const params = new Proxy({}, {
      get() {
        reads += 1;
        throw new Error("FAKE_ONLY_APPLY_FOCUS_MARKER");
      },
    });
    expect(() => applyFocus(params, "synthetic-agent")).toThrow("HOSTED_AUTHORITY_UNAVAILABLE");
    expect(reads).toBe(0);
  });

  test("applyFocus retains its authorized local no-agent behavior", () => {
    process.env.HASNA_TODOS_STORAGE_MODE = "local";
    process.env.TODOS_STORAGE_MODE = "local";
    const params = { project_id: "synthetic-project" };
    expect(() => applyFocus(params)).not.toThrow();
    expect(params).toEqual({ project_id: "synthetic-project" });
  });

  test("handleMcpHttpRequest retains the base public runtime arity of one", () => {
    expect(handleMcpHttpRequest.name).toBe("handleMcpHttpRequest");
    expect(handleMcpHttpRequest.length).toBe(1);
  });

  test("source, built output, and declarations retain MCP exports and arities", () => {
    const root = mkdtempSync(join(tmpdir(), "todos-mcp-compat-"));
    try {
      const build = Bun.spawnSync([
        "bun", "build", "src/mcp/index.ts", "src/mcp/http.ts", "--outdir", join(root, "dist"),
        "--target", "bun", "--external", "@modelcontextprotocol/sdk",
      ], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
      expect(build.exitCode, build.stderr.toString()).toBe(0);
      const declarations = Bun.spawnSync([
        join(REPO_ROOT, "node_modules/.bin/tsc"), "--emitDeclarationOnly", "--outDir", join(root, "types"),
      ], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
      expect(declarations.exitCode, declarations.stderr.toString()).toBe(0);
      const source = readFileSync(join(REPO_ROOT, "src/mcp/index.ts"), "utf8");
      const httpSource = readFileSync(join(REPO_ROOT, "src/mcp/http.ts"), "utf8");
      const indexDeclaration = readFileSync(join(root, "types/mcp/index.d.ts"), "utf8");
      const httpDeclaration = readFileSync(join(root, "types/mcp/http.d.ts"), "utf8");
      expect(source).toMatch(/export function applyFocus\(params: Record<string, any>, agentId\?: string\)/);
      expect(httpSource).toMatch(/export async function handleMcpHttpRequest\(\s*req: Request,?\s*\)/s);
      expect(httpSource).not.toMatch(/export async function handleMcpHttpRequestWithRuntime/);
      expect(indexDeclaration).toContain("export declare function applyFocus(params: Record<string, any>, agentId?: string): void;");
      expect(httpDeclaration).toContain("export declare function handleMcpHttpRequest(req: Request): Promise<Response>;");
      expect(httpDeclaration).not.toContain("handleMcpHttpRequestWithRuntime");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
