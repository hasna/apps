/**
 * Name-conformance gate for hasna/apps.
 *
 * Every workspace member package MUST be named `@hasna/<name>` with the name
 * suffix equal to its directory (`apps/<name>` ↔ `@hasna/<name>`), kebab-case.
 * A `@hasna-internal/*` name or any other scope is a violation: this repo
 * PRODUCES public packages.
 *
 * Every DIRECTORY under apps/ must be a member: a member-looking directory
 * with no package.json is a ghost — invisible to every census and gate while
 * looking like a member to anyone listing apps/ (measured 2026-08-19:
 * apps/otp and apps/personalnotes, both 100% gitignored residue with zero
 * tracked files, hidden from git status while misleading sweeps and agents
 * working the tree). A ghost is refused with the two remedies: add a
 * package.json to make it a member, or delete the residue.
 *
 * Usage:
 *   bun tooling/ci/check-names.ts [--root <dir>]
 *   bun tooling/ci/check-names.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NAME_RE = /^@hasna\/[a-z0-9-]+$/;

function memberPackages(root: string): { members: string[]; ghosts: string[] } {
  const pkgRoot = path.join(root, "package.json");
  if (!fs.existsSync(pkgRoot)) return { members: [], ghosts: [] };
  const rootPkg = JSON.parse(fs.readFileSync(pkgRoot, "utf8"));
  const workspaces: string[] = rootPkg.workspaces ?? [];
  const apps = workspaces.includes("apps/*") ? "apps" : null;
  if (!apps) return { members: [], ghosts: [] };
  const dir = path.join(root, apps);
  if (!fs.existsSync(dir)) return { members: [], ghosts: [] };
  const dirs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const members = dirs
    .filter((name) => fs.existsSync(path.join(dir, name, "package.json")))
    .map((name) => path.join(dir, name));
  const ghosts = dirs.filter((name) => !fs.existsSync(path.join(dir, name, "package.json")));
  return { members, ghosts };
}

function checkDir(root: string): { violations: string[]; count: number; ghosts: string[] } {
  const violations: string[] = [];
  const { members, ghosts } = memberPackages(root);
  for (const dir of members) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const name: string = pkg.name ?? "";
    const slug = path.basename(dir);
    if (!NAME_RE.test(name)) {
      violations.push(`${dir}: package name "${name}" does not match @hasna/<kebab-case>`);
    } else if (name.slice("@hasna/".length) !== slug) {
      violations.push(`${dir}: package name "${name}" does not match directory "${slug}"`);
    }
  }
  const ghostPaths = ghosts.map((name) => path.join(root, "apps", name));
  return { violations, count: members.length, ghosts: ghostPaths };
}

/**
 * README member-claim gate (todos T-00105, row 6fafeaa5).
 *
 * The root README must not advertise a CLI as a member deliverable of this
 * repo when that package is not a member here. Measured 2026-08-24: the
 * README claimed "the unified `hasna` CLI" while `@hasna/cli` (bin `hasna`)
 * is retired/deprecated on npm and has no source in this tree — an audit row
 * then filed "published but NOT deployed" against the retired package.
 *
 * Two patterns, both checked:
 *   A. "the unified `X` CLI" — X must resolve to a member package
 *      (`apps/X/package.json` named `@hasna/X`) or to a member-shipped bin.
 *   B. a concrete backticked `@hasna/<name>` literal in the README must be a
 *      member package, or appear on a line that marks it retired — an honest
 *      retirement note stays, live advertising of a non-member is refused.
 */
const UNIFIED_CLI_RE = /the unified `([a-z0-9-]+)` CLI/g;
const CONCRETE_NAME_RE = /`@hasna\/([a-z0-9-]+)(?:@[^`]*)?`/g;
const RETIRED_RE = /\bretired\b/i;

function checkReadmeClaims(root: string): string[] {
  const readmePath = path.join(root, "README.md");
  if (!fs.existsSync(readmePath)) return [];
  const readme = fs.readFileSync(readmePath, "utf8");
  const memberNames = new Set<string>();
  const memberBins = new Set<string>();
  for (const dir of memberPackages(root).members) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    memberNames.add(pkg.name as string);
    const bin = pkg.bin;
    if (typeof bin === "string") memberBins.add(bin);
    else if (bin && typeof bin === "object") {
      for (const b of Object.values(bin)) memberBins.add(b as string);
    }
  }
  const violations: string[] = [];
  for (const m of readme.matchAll(UNIFIED_CLI_RE)) {
    const slug = m[1];
    if (!memberNames.has(`@hasna/${slug}`) && !memberBins.has(slug)) {
      violations.push(`README.md: advertises "the unified \`${slug}\` CLI" but no member package ships it (no @hasna/${slug} member, no member bin "${slug}")`);
    }
  }
  for (const m of readme.matchAll(CONCRETE_NAME_RE)) {
    const name = `@hasna/${m[1]}`;
    if (memberNames.has(name)) continue;
    const lineStart = readme.lastIndexOf("\n", m.index) + 1;
    const lineEnd = readme.indexOf("\n", m.index);
    const line = readme.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    if (RETIRED_RE.test(line)) continue;
    violations.push(`README.md: names non-member package ${name} without marking it retired (line: "${line.trim()}")`);
  }
  return violations;
}

function run(root: string): number {
  const { violations, count, ghosts } = checkDir(root);
  const readmeViolations = checkReadmeClaims(root);
  if (violations.length > 0 || readmeViolations.length > 0) {
    console.error(`NAME-CONFORMANCE VIOLATIONS (${violations.length + readmeViolations.length}):`);
    for (const v of violations) console.error(`  ${v}`);
    for (const v of readmeViolations) console.error(`  ${v}`);
    return 1;
  }
  if (ghosts.length > 0) {
    console.error(`GHOST MEMBER DIRECTORIES (${ghosts.length}): a directory under apps/ with no package.json is not a member and is invisible to every gate.`);
    for (const g of ghosts) console.error(`  ${g}`);
    console.error(`  remedy: add a package.json to make it a member, or delete the residue directory.`);
    return 1;
  }
  console.log(`name conformance: ${count} member packages, 0 violations, 0 ghost directories`);
  return 0;
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hasna-apps-names-"));
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, "apps"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"] }, null, 2),
  );
  const writeMember = (slug: string, name: string) => {
    const d = path.join(root, "apps", slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name }, null, 2));
  };
  writeMember("foo", "@hasna/foo"); // valid
  writeMember("bar", "@hasna-internal/bar"); // wrong scope -> must fail
  writeMember("baz", "@hasna/other"); // name/dir mismatch -> must fail
  writeMember("qux", "qux"); // un-scoped -> must fail
  // ghost: a member-looking directory with no package.json -> must be flagged
  fs.mkdirSync(path.join(root, "apps", "ghost"), { recursive: true });

  const badRes = checkDir(root);
  check("seeded violations fire (3 violations on 4 members)", badRes.count === 4 && badRes.violations.length === 3);
  check("ghost directory fires (no package.json -> flagged)", badRes.ghosts.length === 1 && badRes.ghosts[0].endsWith(path.join("apps", "ghost")));

  const goodRoot = path.join(tmp, "good");
  fs.mkdirSync(path.join(goodRoot, "apps", "foo"), { recursive: true });
  fs.writeFileSync(
    path.join(goodRoot, "package.json"),
    JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"] }, null, 2),
  );
  fs.writeFileSync(
    path.join(goodRoot, "apps", "foo", "package.json"),
    JSON.stringify({ name: "@hasna/foo" }, null, 2),
  );
  const goodRes = checkDir(goodRoot);
  check("clean tree passes (1 valid member, 0 violations, 0 ghosts)", goodRes.count === 1 && goodRes.violations.length === 0 && goodRes.ghosts.length === 0);

  // README member-claim gate (todos T-00105) — two-sided controls
  const readmeRoot = path.join(tmp, "readme");
  fs.mkdirSync(path.join(readmeRoot, "apps", "foo"), { recursive: true });
  fs.writeFileSync(
    path.join(readmeRoot, "package.json"),
    JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"] }, null, 2),
  );
  fs.writeFileSync(
    path.join(readmeRoot, "apps", "foo", "package.json"),
    JSON.stringify({ name: "@hasna/foo" }, null, 2),
  );
  // positive control A: README advertises "the unified `hasna` CLI" with no cli member -> must fire
  fs.writeFileSync(
    path.join(readmeRoot, "README.md"),
    "Member packages publish per-app CLIs, the unified `hasna` CLI, and SDKs.\n",
  );
  const staleClaim = checkReadmeClaims(readmeRoot);
  check("README unified-CLI claim for a non-member fires", staleClaim.length === 1 && staleClaim[0].includes("no member package ships it"));
  // positive control B: README names a concrete non-member package without retirement -> must fire
  fs.writeFileSync(
    path.join(readmeRoot, "README.md"),
    "Consumers may install `@hasna/ghost` directly.\n",
  );
  const ghostClaim = checkReadmeClaims(readmeRoot);
  check("README concrete non-member name without retirement fires", ghostClaim.length === 1 && ghostClaim[0].includes("@hasna/ghost"));
  // negative control: member + explicitly retired non-member -> must stay silent
  fs.writeFileSync(
    path.join(readmeRoot, "README.md"),
    "Members ship per-app CLIs and SDKs. The retired `@hasna/cli` package (deprecated on npm) is not a member; `@hasna/foo` is.\n",
  );
  const cleanClaims = checkReadmeClaims(readmeRoot);
  check("README member + retired non-member stays silent", cleanClaims.length === 0);

  fs.rmSync(tmp, { recursive: true, force: true });
  if (failed) {
    console.error("self-test FAILED — the gate cannot be trusted");
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
