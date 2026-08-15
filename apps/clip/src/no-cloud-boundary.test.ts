import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { relative } from "node:path";
import { FORBIDDEN_SHARED_CLOUD_RUNTIMES, SCHEMA_IDS } from "@hasna/contracts";

const root = join(import.meta.dir, "..");
// Broad boundary patterns are enforced across the whole in-repo source tree
// (not just docs/Swift), so clip-specific forbidden surfaces that the shared
// contracts no-cloud-scan runtime patterns do not cover — private hosted service
// packages, hosted/billing CLI subcommands, and payment secret env names — cannot
// regress into TypeScript sources, scripts, or the package manifest.
const SUPPLEMENTAL_SOURCE_ROOTS = [
  "bun.lock",
  "CONTRIBUTING.md",
  "Package.swift",
  "README.md",
  "SECURITY.md",
  "Sources",
  "docs",
  "package.json",
  "scripts",
  "src",
] as const;
const SUPPLEMENTAL_TEXT_EXTENSIONS = new Set([
  ".c",
  ".css",
  ".html",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".mjs",
  ".swift",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const SUPPLEMENTAL_SKIP_DIRS = new Set(["dist", "node_modules"]);
const SUPPLEMENTAL_BOUNDARY_PATTERNS = [
  ...FORBIDDEN_SHARED_CLOUD_RUNTIMES.map((runtime) => new RegExp(runtime.replace("/", "\\/"), "i")),
  new RegExp("@hasna/" + "platform\\b", "i"),
  new RegExp("@hasna/" + "tools\\b", "i"),
  new RegExp("@hasna/" + "wallets\\b", "i"),
  new RegExp("cloud-" + "mcp\\b", "i"),
  new RegExp("clip-" + "cloud\\b", "i"),
  new RegExp("clip-" + "hosted\\b", "i"),
  new RegExp("\\.command\\([\"'](" + ["cloud", "hosted", "saas", "billing", "signup", "login"].join("|") + ")\\b", "i"),
  new RegExp("\\b" + ["STRIPE", "SECRET", "KEY"].join("_") + "\\b"),
  new RegExp("\\b" + ["STRIPE", "WEBHOOK", "SECRET"].join("_") + "\\b"),
  new RegExp("\\b" + ["HASNA", "CLOUD"].join("_") + "\\b"),
  new RegExp("\\b" + ["HASNA", "RDS", "PASSWORD"].join("_") + "\\b"),
  new RegExp("\\b" + ["rds", "cluster"].join("_") + "\\b", "i"),
  new RegExp(["hasna", "xyz"].join("-"), "i"),
  new RegExp(["hasna", "studio"].join("-"), "i"),
  new RegExp(["hasna", "studio"].join(""), "i"),
] as const;

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index) : "";
}

function collectSupplementalFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return SUPPLEMENTAL_TEXT_EXTENSIONS.has(extension(path)) ? [path] : [];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    if (SUPPLEMENTAL_SKIP_DIRS.has(entry)) continue;
    files.push(...collectSupplementalFiles(join(path, entry)));
  }
  return files;
}

function supplementalBoundaryHits(): string[] {
  const files = SUPPLEMENTAL_SOURCE_ROOTS.flatMap((entry) => collectSupplementalFiles(join(root, entry)));
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (SUPPLEMENTAL_BOUNDARY_PATTERNS.some((pattern) => pattern.test(text))) {
      hits.push(relative(root, file));
    }
  }
  return hits.sort();
}

describe("local and self-hosted boundary", () => {
  it("emits a passing contracts no-cloud evidence pack for the source tree", async () => {
    const scan = Bun.spawn(["bun", "run", "contracts", "no-cloud-scan", ".", "--json"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(scan.stdout).text();
    const stderr = await new Response(scan.stderr).text();
    expect(await scan.exited).toBe(0);
    expect(stderr.trim()).toBe("");

    const evidence = JSON.parse(stdout) as {
      schema: string;
      status: string;
      verdict: string;
      packageName: string;
      checks: Array<{ id: string; status: string }>;
      findings: unknown[];
    };
    expect(evidence.schema).toBe(SCHEMA_IDS.noCloudEvidencePack);
    expect(evidence.packageName).toBe("@hasna/clip");
    expect(evidence.status).toBe("succeeded");
    expect(evidence.verdict).toBe("passed");
    expect(evidence.findings).toEqual([]);
    expect(evidence.checks.map((check) => [check.id, check.status])).toEqual([
      ["package_manifest", "succeeded"],
      ["lockfile", "succeeded"],
      ["source_runtime", "succeeded"],
    ]);
  });

  it("keeps TypeScript sources, scripts, manifest, Swift, and docs inside the local/self-hosted boundary", () => {
    expect(supplementalBoundaryHits()).toEqual([]);
  });
});
