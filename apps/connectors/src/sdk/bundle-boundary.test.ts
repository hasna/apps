import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

/** `bun build --target bun` rewrites `node:fs` to `fs`; both spellings are builtins. */
function isBuiltin(specifier: string): boolean {
  if (specifier.startsWith("node:") || specifier.startsWith("bun")) return true;
  return builtinModules.includes(specifier);
}

/**
 * The `./sdk` export must stay self-contained (package-surfaces rule): the
 * source imports node builtins only — never the connector runtime
 * (`../lib`, `../db`, `../server`, `../mcp`), never the package itself — and
 * the built bundle, when present, carries no bare package specifier.
 */
describe("SDK bundle boundary", () => {
  const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
  const specifiers = [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]!);

  it("does not import the connector runtime from the SDK entrypoint", () => {
    expect(source).not.toMatch(/from\s+["']@hasna\/connectors["']/);
    expect(source).not.toMatch(/from\s+["'](?:\.\.\/)+(?:lib|db|server|mcp|cli|social)\//);
    expect(source).not.toMatch(/from\s+["'](?:\.\.\/)?connectors\//);
    expect(source).not.toMatch(/import\(["']@hasna\/connectors["']\)/);
  });

  it("imports node builtins only", () => {
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("node:")).toBe(true);
    }
  });

  it("the built dist/sdk/index.js has no bare package import", () => {
    const built = join(import.meta.dir, "..", "..", "dist", "sdk", "index.js");
    if (!existsSync(built)) return; // built by `bun run build`; the source check above still holds
    const bundle = readFileSync(built, "utf8");
    const bare = [...bundle.matchAll(/(?:from|import\()\s*["']([^"'./][^"']*)["']/g)]
      .map((m) => m[1]!)
      .filter((s) => !isBuiltin(s));
    expect(bare).toEqual([]);
  });
});
