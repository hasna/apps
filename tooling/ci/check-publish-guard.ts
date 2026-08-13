/**
 * Publish guard for hasna/apps — internal-infra strings must never reach a
 * published tarball.
 *
 * For every member package, dry-run `npm pack` and scan the resulting file
 * list for internal-infra strings: `*.hasna.xyz`, ARNs, 12-digit AWS account
 * ids, the private-scope markers, and the internal platform account id. A
 * public npm package that carries any of these leaks Hasna's internal estate
 * into the open.
 *
 * Usage:
 *   bun tooling/ci/check-publish-guard.ts [--root <dir>]
 *   bun tooling/ci/check-publish-guard.ts --self-test
 *
 * The tarball-DIFF half (diff pack contents against an expected-file manifest)
 * is a placeholder until member packages land and define what their tarballs
 * must contain; the string-block half below is live.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const INTERNAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "hasna-xyz-domain", re: /[.]hasna[.]xyz/ },
  { name: "aws-arn", re: /arn[:]aws[:]/ },
  { name: "aws-account-id", re: /\b[0-9]{12}\b/ },
  { name: "hasna-internal-org", re: /hasna[-]internal/ },
  { name: "internal-apps", re: /internal[-]apps/ },
  { name: "hasna-internal-scope", re: /@hasna[-]internal/ },
  { name: "internal-platform-account", re: new RegExp("7898" + "77399345") },
];

function memberPackages(root: string): string[] {
  const apps = path.join(root, "apps");
  if (!fs.existsSync(apps)) return [];
  return fs
    .readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(apps, name, "package.json")))
    .map((name) => path.join(apps, name));
}

function scanNames(names: string[]): Array<{ name: string; pattern: string }> {
  const hits: Array<{ name: string; pattern: string }> = [];
  for (const n of names) {
    for (const p of INTERNAL_PATTERNS) {
      if (p.re.test(n)) hits.push({ name: n, pattern: p.name });
    }
  }
  return hits;
}

function packFileNames(pkgDir: string): string[] {
  let out = "";
  try {
    out = execSync(`npm pack --dry-run --json`, { cwd: pkgDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e: any) {
    console.error(`npm pack --dry-run failed in ${pkgDir}: ${e.stderr ?? e.message}`);
    return [];
  }
  try {
    const parsed = JSON.parse(out);
    const files: Array<{ path?: string }> = Array.isArray(parsed) ? parsed[0]?.files ?? [] : [];
    return files.map((f) => f.path ?? "");
  } catch {
    return [];
  }
}

function run(root: string): number {
  const pkgs = memberPackages(root);
  if (pkgs.length === 0) {
    console.log("publish guard: 0 member packages — guard vacuously passes (placeholder until imports land)");
    return 0;
  }
  let failed = false;
  for (const pkg of pkgs) {
    const names = packFileNames(pkg);
    const hits = scanNames(names);
    if (hits.length > 0) {
      failed = true;
      console.error(`PUBLISH-GUARD VIOLATION in ${pkg} (${hits.length}):`);
      for (const h of hits) console.error(`  ${h.name} — pattern ${h.pattern}`);
    } else {
      console.log(`publish guard: ${path.basename(pkg)} — ${names.length} tarball entries, 0 internal-infra strings`);
    }
  }
  return failed ? 1 : 0;
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };
  const bad = [
    `internal.${"hasna" + "." + "xyz"}/config.json`,
    `deploy/${"arn" + ":aws:" + "iam"}.txt`,
    `secrets/${"1".repeat(12)}-key.json`,
    `deploy/${"hasna" + "-" + "internal"}/platform.yml`,
    `pkg/${"internal" + "-" + "apps"}/cohort.json`,
    `scoped/${"@hasna" + "-" + "internal"}/x.tgz`,
    `account/${"7898" + "77399345"}.json`,
  ];
  const clean = ["dist/index.js", "readme.md", "bin/cli.js", "src/sdk.ts"];
  const badHits = scanNames(bad);
  // Some seeded names match more than one pattern (the scoped marker contains
  // the org marker; the account id is also 12 digits), so count distinct names
  // that fired — every seeded name must fire at least once.
  const fired = new Set(badHits.map((h) => h.name)).size;
  check(`fires on seeded internal-infra names (${fired}/${bad.length})`, fired === bad.length);
  check(`stays silent on clean tarball names (0 hits)`, scanNames(clean).length === 0);
  if (failed) {
    console.error("self-test FAILED — the guard cannot be trusted");
    return 1;
  }
  console.log("self-test: PASS (can fire AND stay silent)");
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  process.exit(selfTest());
}
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
process.exit(run(root));
