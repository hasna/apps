/**
 * Name-conformance gate for hasna/apps.
 *
 * Every workspace member package MUST be named `@hasna/<name>` with the name
 * suffix equal to its directory (`apps/<name>` ↔ `@hasna/<name>`), kebab-case.
 * A `@hasna-internal/*` name or any other scope is a violation: this repo
 * PRODUCES public packages.
 *
 * Usage:
 *   bun tooling/ci/check-names.ts [--root <dir>]
 *   bun tooling/ci/check-names.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NAME_RE = /^@hasna\/[a-z0-9-]+$/;

function memberPackages(root: string): string[] {
  const pkgRoot = path.join(root, "package.json");
  if (!fs.existsSync(pkgRoot)) return [];
  const rootPkg = JSON.parse(fs.readFileSync(pkgRoot, "utf8"));
  const workspaces: string[] = rootPkg.workspaces ?? [];
  const apps = workspaces.includes("apps/*") ? "apps" : null;
  if (!apps) return [];
  const dir = path.join(root, apps);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(dir, name, "package.json")))
    .map((name) => path.join(dir, name));
}

function checkDir(root: string): { violations: string[]; count: number } {
  const violations: string[] = [];
  const pkgs = memberPackages(root);
  for (const dir of pkgs) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const name: string = pkg.name ?? "";
    const slug = path.basename(dir);
    if (!NAME_RE.test(name)) {
      violations.push(`${dir}: package name "${name}" does not match @hasna/<kebab-case>`);
    } else if (name.slice("@hasna/".length) !== slug) {
      violations.push(`${dir}: package name "${name}" does not match directory "${slug}"`);
    }
  }
  return { violations, count: pkgs.length };
}

function run(root: string): number {
  const { violations, count } = checkDir(root);
  if (violations.length > 0) {
    console.error(`NAME-CONFORMANCE VIOLATIONS (${violations.length}):`);
    for (const v of violations) console.error(`  ${v}`);
    return 1;
  }
  console.log(`name conformance: ${count} member packages, 0 violations`);
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

  const badRes = checkDir(root);
  check("seeded violations fire (3 violations on 4 members)", badRes.count === 4 && badRes.violations.length === 3);

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
  check("clean tree passes (1 valid member, 0 violations)", goodRes.count === 1 && goodRes.violations.length === 0);

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
