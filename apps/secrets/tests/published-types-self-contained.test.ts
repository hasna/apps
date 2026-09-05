// The published TYPE surface must be installable, not just the bundles.
//
// THE GAP THIS CLOSES. `bun build --target bun` inlines everything, so
// `dist/*.js` imports node builtins only and the runtime surface is
// self-contained by construction. `tsc --emitDeclarationOnly` inlines nothing:
// every import the source wrote survives into `dist/**/*.d.ts`. hasna/apps#1720
// deleted the vendored `src/store/contracts-client/` copy and, with it, moved
// `import ... from "@hasna/contracts/client"` onto `dist/sdk.d.ts` — the `.`
// and `./sdk` type entry — while `@hasna/contracts` is a devDependency, which
// a consumer never installs. `npm pack` + `tsc` in a clean consumer project
// returned 7 x TS2307 "Cannot find module '@hasna/contracts/client'". Nothing
// caught it: `package-surface.test.ts` imports the SDK from inside this
// workspace, where every devDependency is present, so it type-checks from a
// position no consumer is ever in.
//
// WHAT THIS ASSERTS. Walk the declaration graph from every `types` entry the
// package's `exports` map publishes, and require each bare specifier to be a
// node builtin or a DECLARED RUNTIME dependency (dependencies /
// peerDependencies / optionalDependencies). Reachability is the boundary on
// purpose: a module a consumer cannot address through `exports` is free to
// import a build-time package, and `dist/store/client.d.ts` (the resolver seam)
// and `dist/server/serve.d.ts` (the serve bin) both do.

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const rootDir = join(import.meta.dir, "..");

type PackageManifest = {
  types?: string;
  exports?: Record<string, { types?: string; import?: string }>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function manifest(dir: string = rootDir): PackageManifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageManifest;
}

/** Every `.d.ts` a consumer can address through `types` or `exports[*].types`. */
function publishedTypeEntries(pkg: PackageManifest, dir: string): string[] {
  const entries = new Set<string>();
  if (pkg.types) entries.add(pkg.types);
  for (const entry of Object.values(pkg.exports ?? {})) {
    if (typeof entry?.types === "string") entries.add(entry.types);
  }
  return [...entries].map((p) => resolve(dir, p));
}

/**
 * Comments out, so prose cannot be read as an import.
 *
 * `dist/sdk.d.ts` carries a doc comment that talks ABOUT @hasna/contracts;
 * matching `from "..."` across it would fail this gate on a sentence.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

/** `from "x"`, `import("x")` and bare `import "x"`, as they survive into a `.d.ts`. */
function specifiersIn(source: string): string[] {
  const code = withoutComments(source);
  const out: string[] = [];
  const patterns = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s+["']([^"']+)["']/gm];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) out.push(match[1]!);
  }
  return out;
}

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** The `.d.ts` a relative specifier resolves to, or null when there is none. */
function resolveDeclaration(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.replace(/\.js$/, ".d.ts"),
    base.replace(/\.mjs$/, ".d.mts"),
    `${base}.d.ts`,
    join(base, "index.d.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export interface SurfaceWalk {
  /** Declaration files reachable from a published `types` entry, repo-relative. */
  reachable: string[];
  /** `<file>: <specifier>` for every unresolvable or undeclared import. */
  violations: string[];
}

export function walkPublishedTypeSurface(dir: string = rootDir): SurfaceWalk {
  const pkg = manifest(dir);
  const runtimeDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  const violations: string[] = [];
  const seen = new Set<string>();
  const queue = publishedTypeEntries(pkg, dir);
  for (const entry of queue) {
    if (!existsSync(entry)) violations.push(`${relative(dir, entry)}: published types entry does not exist`);
  }

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const here = relative(dir, file);
    for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const target = resolveDeclaration(file, specifier);
        if (target) queue.push(target);
        else violations.push(`${here}: relative import "${specifier}" resolves to no declaration file`);
        continue;
      }
      if (specifier.startsWith("node:") || isBuiltin(specifier)) continue;
      const name = packageNameOf(specifier);
      if (!runtimeDeps.has(name)) {
        violations.push(
          `${here}: imports "${specifier}" but "${name}" is not a runtime dependency ` +
            `(it is ${pkg.devDependencies?.[name] ? "a devDependency" : "undeclared"}), so a consumer cannot resolve it`,
        );
      }
    }
  }

  return { reachable: [...seen].map((f) => relative(dir, f)).sort(), violations };
}

function ensureBuilt(): void {
  const missing = publishedTypeEntries(manifest(), rootDir).filter((entry) => !existsSync(entry));
  if (missing.length === 0) return;
  const built = Bun.spawnSync({ cmd: ["bun", "run", "build"], cwd: rootDir, env: { ...process.env } });
  expect(built.exitCode, new TextDecoder().decode(built.stderr)).toBe(0);
}

describe("published type surface is self-contained", () => {
  it("resolves every declaration a consumer can reach with runtime dependencies alone", () => {
    ensureBuilt();
    const { reachable, violations } = walkPublishedTypeSurface();

    // The walk actually walked: the SDK entry and the declarations behind the
    // `./storage` export are in it. Without this an empty dist would pass.
    expect(reachable).toContain("dist/sdk.d.ts");
    expect(reachable).toContain("dist/sdk/client.d.ts");
    expect(reachable).toContain("dist/store/index.d.ts");
    expect(reachable).toContain("dist/store/api.d.ts");
    expect(reachable).toContain("dist/store/client-types.d.ts");

    expect(violations, `published type surface violations:\n${violations.join("\n")}`).toEqual([]);
  });

  it("keeps the credential seam OFF the reachable surface", () => {
    ensureBuilt();
    // `dist/store/client.d.ts` re-exports @hasna/contracts VALUES for this
    // package's own modules. That is only sound while no published entry
    // reaches it — if it ever appears here, the types it re-exports have to
    // move into ./client-types.ts too.
    expect(walkPublishedTypeSurface().reachable).not.toContain("dist/store/client.d.ts");
  });

  it("self-test: the walk fires on a devDependency reached from a published entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-surface-self-test-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "@hasna/fixture",
          types: "./dist/sdk.d.ts",
          exports: { ".": { types: "./dist/sdk.d.ts" } },
          dependencies: { commander: "^13.1.0" },
          devDependencies: { "@hasna/contracts": "1.0.1" },
        }),
      );
      mkdirSync(join(dir, "dist", "store"), { recursive: true });
      writeFileSync(join(dir, "dist", "sdk.d.ts"), 'export * from "./store/client.js";\n');
      writeFileSync(
        join(dir, "dist", "store", "client.d.ts"),
        'import { type X } from "@hasna/contracts/client";\nimport { Command } from "commander";\nimport { join } from "node:path";\nexport declare const a: X, b: Command, c: typeof join;\n',
      );

      const { reachable, violations } = walkPublishedTypeSurface(dir);
      expect(reachable).toContain("dist/store/client.d.ts");
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain("@hasna/contracts/client");
      expect(violations[0]).toContain("devDependency");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("self-test: a doc comment that talks about a package is not an import", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-surface-self-test-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "@hasna/fixture", exports: { ".": { types: "./dist/sdk.d.ts" } } }),
      );
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(
        join(dir, "dist", "sdk.d.ts"),
        '/**\n * Credentials come from "@hasna/contracts", resolved fresh per call.\n */\n// also from "@hasna/nope"\nexport declare const a: string;\n',
      );

      expect(walkPublishedTypeSurface(dir).violations).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("self-test: a relative import with no declaration behind it is a violation", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-surface-self-test-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "@hasna/fixture", exports: { ".": { types: "./dist/sdk.d.ts" } } }),
      );
      mkdirSync(join(dir, "dist"), { recursive: true });
      writeFileSync(join(dir, "dist", "sdk.d.ts"), 'export * from "./gone.js";\n');

      const { violations } = walkPublishedTypeSurface(dir);
      expect(violations).toEqual(['dist/sdk.d.ts: relative import "./gone.js" resolves to no declaration file']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
