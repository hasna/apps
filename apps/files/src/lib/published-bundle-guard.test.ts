import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";

/**
 * Regression lock for the release-gate finding of 2026-08-21: the packed
 * tarball of @hasna/files carried `https://${name}.hasna.xyz` inside
 * dist/cli/index.js and dist/mcp/index.js — an internal-infra domain leaked
 * into a public package because @hasna/contracts was resolved at the ancient
 * registry version 0.5.2 whose client transport hardcodes that default host.
 * The CI publish-guard scans tarball entry PATHS only, so content reached the
 * tarball. This test rebuilds the bundles that ship in the tarball and asserts
 * the internal-infra patterns are absent from the CONTENT.
 *
 * The same publish-surface lock is applied to the DECLARATIONS: `@hasna/contracts`
 * is a BUILD-TIME dependency (every bundle inlines it), so the `.d.ts` files a
 * TS consumer resolves must never import it — a consumer installs this
 * package's runtime dependencies and not its devDependencies, and
 * TS2307 "Cannot find module '@hasna/contracts/…'" is exactly the failure
 * hasna/apps#1782 closed for @hasna/secrets. The four declared entries
 * (".", "./sdk", "./path", "./s3") plus their transitive import closure are
 * asserted import-free; the deep server leaves (dist/server/*.d.ts) are not in
 * that closure and keep the same status they have today.
 */

const INTERNAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "hasna-xyz-domain", re: /[.]hasna[.]xyz/ },
  { name: "aws-arn", re: /arn[:]aws[:]/ },
  { name: "hasna-internal-org", re: /hasna[-]internal/ },
  { name: "internal-apps", re: /internal[-]apps/ },
  { name: "hasna-internal-scope", re: /@hasna[-]internal/ },
];

/** The exported declaration entries a consumer can reach (package.json exports). */
const ENTRY_DECLARATIONS = ["index.d.ts", "sdk/index.d.ts", "lib/path.d.ts", "s3.d.ts"] as const;

const CONTRACTS_IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+)["']@hasna\/contracts(?:\/[^"']*)?["']/;
const RELATIVE_IMPORT_RE = /from\s+["'](\.[^"']+\.js)["']/g;

const ROOT = join(import.meta.dir, "..", "..");
let outDirs: string[] = [];

beforeEach(() => {
  outDirs = [mkdtempSync(join(tmpdir(), "files-bundle-guard-")), mkdtempSync(join(tmpdir(), "files-bundle-guard-"))];
});

afterEach(() => {
  for (const dir of outDirs) rmSync(dir, { recursive: true, force: true });
  outDirs = [];
});

function buildEntry(outDir: string, entry: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["bun", "build", entry, "--outdir", outDir, "--target", "bun", ...args],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
}

/** Emit declarations into `outDir` the way the package build does (tsc --emitDeclarationOnly). */
function emitDeclarations(outDir: string): void {
  const result = Bun.spawnSync({
    cmd: ["bunx", "tsc", "--emitDeclarationOnly", "--outDir", outDir],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  expect(readFileSync(join(outDir, "index.d.ts"), "utf8").length).toBeGreaterThan(0);
}

/** The transitive closure of relative `.js` imports from a set of `.d.ts` entries. */
function declarationClosure(outDir: string, entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((entry) => resolve(outDir, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    const normalized = resolve(file);
    if (!normalized.startsWith(outDir)) continue; // never follow a path outside the emit tree
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const text = readFileSync(normalized, "utf8");
    for (const match of text.matchAll(RELATIVE_IMPORT_RE)) {
      const target = resolve(dirname(normalized), match[1]!.replace(/\.js$/, ".d.ts"));
      if (!target.startsWith(outDir)) continue;
      queue.push(target);
    }
  }
  return [...seen];
}

describe("published bundle content guard", () => {
  test("cli and mcp bundles carry no internal-infra strings", () => {
    const [cliOut, mcpOut] = outDirs;
    buildEntry(cliOut, "src/cli/index.tsx", [
      "--external", "ink",
      "--external", "react",
      "--external", "chalk",
      "--external", "@modelcontextprotocol/sdk",
      "--external", "@aws-sdk/*",
      "--external", "pg",
    ]);
    buildEntry(mcpOut, "src/mcp/index.ts", [
      "--external", "@modelcontextprotocol/sdk",
      "--external", "@aws-sdk/*",
      "--external", "pg",
    ]);

    for (const [label, outDir] of [["cli", cliOut], ["mcp", mcpOut]] as const) {
      const text = readFileSync(join(outDir, "index.js"), "utf8");
      for (const { name, re } of INTERNAL_PATTERNS) {
        const hit = re.exec(text);
        expect(hit, `${label} bundle matched ${name}: ${hit?.[0]}`).toBeNull();
      }
    }
  });

  // tsc --emitDeclarationOnly over the whole package takes well over bun's 5 s
  // default on a cold CI runner (it timed out at 5153 ms on ubuntu); the guard
  // itself is cheap once the declarations exist.
  test("published declaration entries and their closure never import @hasna/contracts (#1782)", () => {
    const [declOut] = outDirs;
    emitDeclarations(declOut);

    const closure = declarationClosure(declOut, ENTRY_DECLARATIONS);
    // The sdk entry pulls the server OpenAPI document; make sure the closure
    // is broad enough that a removed guard leaves fingerprints here.
    expect(closure.some((file) => file.includes("server/openapi.d.ts"))).toBe(true);

    const offenders = closure.filter((file) => CONTRACTS_IMPORT_RE.test(readFileSync(file, "utf8")));
    expect(
      offenders.map((file) => file.slice(declOut.length + 1)),
      "published entry declarations (and their imports) must not reference @hasna/contracts — a TS consumer would hit TS2307",
    ).toEqual([]);
  }, 120_000);
});