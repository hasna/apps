/**
 * @hasna/logs — the `./sdk` export (package-surfaces rule, hasna/apps#1720).
 *
 * `@hasna/logs/sdk` is the canonical SDK subpath of the ONE package: it
 * carries the resolver-backed hosted-API client (`./api` stays the alias),
 * is declared in package.json exports, and bundles self-contained — a
 * consumer that imports it loads node builtins only, never a bare package
 * (the SDK must not drag the CLI/MCP dependency tree along).
 */
import { builtinModules } from "node:module";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import * as api from "./api.ts";
import * as sdk from "./sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

describe("@hasna/logs/sdk", () => {
  test("is declared in package.json exports beside ./api", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
      exports: Record<string, { import?: string; types?: string }>;
      scripts: Record<string, string>;
    };
    expect(pkg.exports["./sdk"]).toEqual({ types: "./dist/sdk.d.ts", import: "./dist/sdk.js" });
    expect(pkg.exports["./api"]?.import).toBe("./dist/api.js");
    expect(pkg.scripts["build:js"]).toContain("src/sdk.ts");
  });

  test("the contract manifest declares the sdk surface supported at ./sdk from the served OpenAPI", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "hasna.contract.json"), "utf8")) as {
      serviceSurfaces: Array<Record<string, unknown>>;
    };
    const surface = manifest.serviceSurfaces.find((s) => s.kind === "sdk");
    expect(surface).toMatchObject({
      status: "supported",
      exportSubpath: "./sdk",
      generatedFrom: "/openapi.json",
    });
    const apiSurface = manifest.serviceSurfaces.find((s) => s.kind === "api");
    expect(apiSurface?.openApiPath).toBe(surface?.generatedFrom);
  });

  test("re-exports the resolver-backed client surface of ./api", () => {
    expect(typeof sdk.createLogsApiClientFromEnv).toBe("function");
    expect(sdk.createLogsApiClientFromEnv).toBe(api.createLogsApiClientFromEnv);
    expect(sdk.LogsClient).toBe(api.LogsClient);
    expect(Object.keys(sdk).sort()).toEqual(Object.keys(api).sort());
  });

  test("bundles self-contained: only node builtins survive the build", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "logs-sdk-bundle-"));
    try {
      const result = await Bun.build({
        entrypoints: [join(here, "sdk.ts")],
        outdir,
        target: "bun",
        splitting: false,
        minify: false,
      });
      expect(result.success).toBe(true);
      const files = readdirSync(outdir).filter((name) => name.endsWith(".js"));
      expect(files.length).toBeGreaterThan(0);
      const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
      const foreign = new Set<string>();
      for (const file of files) {
        const text = readFileSync(join(outdir, file), "utf8");
        const specifiers = [
          ...text.matchAll(/\bfrom\s*["']([^"']+)["']/g),
          ...text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
          ...text.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
        ].map((m) => m[1] as string);
        for (const spec of specifiers) {
          if (spec.startsWith("bun:") || spec === "bun" || builtins.has(spec)) continue;
          foreign.add(spec);
        }
      }
      expect([...foreign]).toEqual([]);
    } finally {
      rmSync(outdir, { recursive: true, force: true });
    }
  });
});
