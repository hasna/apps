// The `./sdk` bundle must be self-contained: node builtins only (package-surfaces
// rule; hasna/apps#1720 validation).
//
// `dist/sdk/index.js` is the hosted-only HTTP client a consumer imports as
// `@hasna/conversations/sdk`. `bun build --target bun` inlines every package
// dependency, so the only specifiers that survive in the output are the ones
// the bundler treats as external: node builtins and `bun:*` modules. Before
// this test the generated file re-exported `IdentityError` from
// `../lib/identity.ts`, which imports `../lib/db.ts`, which opens `bun:sqlite`
// — so an SDK consumer's bundle carried the whole on-box store and a
// `bun:sqlite` import it can never legitimately use.
//
// The build is reproduced here from the package's own build script rather
// than by reading `dist/`, so the assertion holds on a tree that has not been
// built, and the ROOT bundle (which legitimately holds the LocalStore) is the
// positive control that proves the scanner sees a `bun:sqlite` import when
// one is there.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import packageJson from "../../package.json";

const root = join(import.meta.dir, "..", "..");
const SDK_ENTRY = "./src/sdk/index.ts";
const ROOT_ENTRY = "./src/index.ts";
const outDirs: string[] = [];

afterEach(() => {
  for (const dir of outDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The build script must bundle the SDK entry for `--target bun` with no `--external` beside it. */
function sdkBuildSegment(): string {
  const segments = packageJson.scripts.build.split("&&").map((s) => s.trim());
  const matches = segments.filter((s) => s.startsWith("bun build ") && s.includes(SDK_ENTRY));
  expect(matches).toHaveLength(1);
  expect(matches[0]).toContain("--target bun");
  expect(matches[0]).not.toContain("--external");
  return matches[0]!;
}

function build(entry: string): string {
  const outDir = mkdtempSync(join(tmpdir(), "conversations-sdk-bundle-"));
  outDirs.push(outDir);
  const built = Bun.spawnSync(["bun", "build", entry, "--target", "bun", "--outdir", outDir], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(built.stderr.toString() + built.stdout.toString()).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return readFileSync(join(outDir, basename(entry).replace(/\.ts$/, ".js")), "utf8");
}

/** Every module specifier the bundle still resolves at run time. */
function importSpecifiers(code: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /^\s*import\s+[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /^\s*export\s+[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\b__require\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1]!);
  }
  return [...specifiers].sort();
}

function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier;
  return builtinModules.includes(bare) || builtinModules.includes(specifier);
}

describe("dist/sdk/index.js is self-contained", () => {
  test("the SDK bundle imports node builtins only — no bun:sqlite, no package specifiers", () => {
    sdkBuildSegment();
    const code = build(SDK_ENTRY);
    const specifiers = importSpecifiers(code);

    // The scanner saw SOMETHING: the resolver seam needs child_process/fs/os.
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((s) => !isNodeBuiltin(s))).toEqual([]);
    expect(specifiers.some((s) => s.startsWith("bun:"))).toBe(false);
    expect(code).not.toContain("bun:sqlite");
    // The resolver seam and the identity error both made it in.
    expect(code).toContain("resolveConversationsSdkTransport");
    expect(code).toContain("IDENTITY_NOT_SET");
  });

  test("positive control: the ROOT bundle (which ships the LocalStore) does import bun:sqlite", () => {
    const code = build(ROOT_ENTRY);
    const specifiers = importSpecifiers(code);
    expect(specifiers).toContain("bun:sqlite");
  });
});
