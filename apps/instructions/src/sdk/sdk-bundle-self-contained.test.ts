import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../../package.json";

/**
 * The `./sdk` export of @hasna/instructions must be SELF-CONTAINED: node
 * builtins only (package-surfaces rule — the SDK bundle is what a consumer
 * pays for, and `@hasna/contracts` is a devDependency inlined at build time,
 * never resolved from the consumer's tree). A bare specifier left in
 * dist/sdk/index.js would be resolved from whatever the consumer happens to
 * have installed — or auto-installed at npm `latest` — which is the failure
 * class that took @hasna/todos 0.13.9 down.
 *
 * Two-sided: the real build command (read from package.json, not copied) must
 * produce a bundle with no non-builtin specifier, and the SAME scan must reject
 * a deliberately externalized build of the same entrypoint — so a scan that
 * cannot fire cannot pass this test.
 */

const root = join(import.meta.dir, "../..");
const SDK_ENTRY = "src/sdk/index.ts";
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sdkBuildCommand(): string {
  const segments = packageJson.scripts.build.split("&&").map((segment) => segment.trim());
  const matches = segments.filter((segment) => segment.startsWith(`bun build ${SDK_ENTRY} `));
  expect(matches).toHaveLength(1);
  expect(matches[0]).toContain("--outdir dist/sdk");
  return matches[0]!;
}

function build(extraFlags = ""): string {
  const outDir = mkdtempSync(join(tmpdir(), "instructions-sdk-bundle-"));
  tempDirs.push(outDir);
  const command = `${sdkBuildCommand().replace("--outdir dist/sdk", `--outdir ${JSON.stringify(outDir)}`)} ${extraFlags}`;
  const built = Bun.spawnSync(["sh", "-c", command], { cwd: root, stdout: "pipe", stderr: "pipe" });
  expect(built.stderr.toString() + built.stdout.toString()).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return join(outDir, "index.js");
}

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** Every module specifier the bundle still imports at run time, minus node builtins. */
function nonBuiltinSpecifiers(bundlePath: string): string[] {
  const source = readFileSync(bundlePath, "utf8");
  const specifiers = new Set<string>();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]!);
  }
  return [...specifiers].filter((specifier) => !BUILTINS.has(specifier)).sort();
}

describe("@hasna/instructions ./sdk bundle is self-contained", () => {
  test("package.json exports ./sdk from the built bundle", () => {
    const exportsField = packageJson.exports as Record<string, { import?: string; types?: string }>;
    expect(exportsField["./sdk"]?.import).toBe("./dist/sdk/index.js");
    expect(exportsField["./sdk"]?.types).toBe("./dist/sdk/index.d.ts");
  });

  test("the real build leaves no non-builtin specifier in dist/sdk/index.js", () => {
    const bundle = build();
    expect(nonBuiltinSpecifiers(bundle)).toEqual([]);
    // The resolver is inlined, not imported: the chain's Keychain item prefix
    // is present in the bundle text itself.
    expect(readFileSync(bundle, "utf8")).toContain("hasna.credentials.");
  });

  test("positive control: an externalized build of the same entry IS rejected by the scan", () => {
    const bundle = build("--external '@hasna/contracts' --external '@hasna/contracts/*'");
    const leftovers = nonBuiltinSpecifiers(bundle);
    expect(leftovers.length).toBeGreaterThan(0);
    expect(leftovers.some((specifier) => specifier.startsWith("@hasna/contracts"))).toBe(true);
  });
});
