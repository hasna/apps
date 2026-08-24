/**
 * Dependency-direction gate for hasna/apps.
 *
 * Every member of this repo is a PUBLIC `@hasna/*` producer package. A member
 * that DECLARES a dependency on the private `@hasna-internal/*` scope wires
 * its published artifact to Hasna's internal estate: the packed package.json
 * carries the private-scope name (the pack-time publish-guard already blocks
 * that in a tarball), and the source tree depends on a private package that
 * this public repo's CI cannot even install.
 *
 * The direction law: this repo PRODUCES public packages. Nothing here may
 * depend on @hasna-internal/* or any other private scope. A declared
 * private-scope dependency in ANY of the four dependency fields —
 * dependencies, devDependencies, peerDependencies, optionalDependencies — is
 * a violation, and the check is source-level so it fires on the declaration
 * at first commit rather than only at pack time (defense-in-depth; measured
 * 2026-08-24: 0 of 75 members declare any private-scope dependency at head).
 *
 * Deliberately NOT flagging public non-@hasna scopes: @hasnaxyz/*,
 * @hasnatools/*, @hasnastudio/*, @hasnafamily/* and third-party scopes
 * (@aws-sdk/*, @types/*, ...) are public npm scopes and are legitimate
 * dependencies of a public package. Only Hasna's PRIVATE scope(s) are
 * refused; the prefix list below is the complete private set.
 *
 * Usage:
 *   bun tooling/ci/check-dependency-direction.ts [--root <dir>]
 *   bun tooling/ci/check-dependency-direction.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The private scope(s) a public producer tree must never depend on. Only
// Hasna's internal scope is private today; public Hasna-org and third-party
// scopes are legitimate and MUST NOT be flagged (proven two-sided in the
// self-test below). Extend this list if a new private scope ever appears.
const PRIVATE_SCOPE_PREFIXES = ["@hasna-internal/"];

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function memberPackages(root: string): string[] {
  const apps = path.join(root, "apps");
  if (!fs.existsSync(apps)) return [];
  return fs
    .readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .filter((name) => fs.existsSync(path.join(apps, name, "package.json")))
    .map((name) => path.join(apps, name));
}

function checkDependencies(root: string): { violations: string[]; count: number } {
  const members = memberPackages(root);
  const violations: string[] = [];
  for (const dir of members) {
    let pkg: any;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    } catch {
      // A member whose package.json does not parse is already refused by the
      // name-conformance and manifests gates; this gate stays silent rather
      // than duplicating the failure.
      continue;
    }
    for (const field of DEP_FIELDS) {
      const deps = pkg[field];
      if (!deps || typeof deps !== "object") continue;
      for (const name of Object.keys(deps)) {
        for (const prefix of PRIVATE_SCOPE_PREFIXES) {
          if (name.startsWith(prefix)) {
            violations.push(`${dir}: ${field} declares private-scope dependency "${name}" — this repo produces public @hasna/* packages and must not depend on ${prefix}*`);
          }
        }
      }
    }
  }
  return { violations, count: members.length };
}

function run(root: string): number {
  const { violations, count } = checkDependencies(root);
  if (violations.length > 0) {
    console.error(`DEPENDENCY-DIRECTION VIOLATIONS (${violations.length}):`);
    for (const v of violations) console.error(`  ${v}`);
    return 1;
  }
  console.log(`dependency direction: ${count} member packages, 0 private-scope dependencies`);
  return 0;
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hasna-apps-depdir-"));
  const writeMember = (root: string, slug: string, deps: Record<string, string>) => {
    const d = path.join(root, "apps", slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: `@hasna/${slug}`, ...deps }, null, 2));
  };

  // Bad tree: a private-scope dependency must FIRE in every scanned field.
  const badRoot = path.join(tmp, "bad");
  fs.mkdirSync(badRoot, { recursive: true });
  fs.writeFileSync(
    path.join(badRoot, "package.json"),
    JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"] }, null, 2),
  );
  writeMember(badRoot, "leaks-deps", { dependencies: { "@hasna-internal/foo": "0.1.0" } });
  writeMember(badRoot, "leaks-dev", { devDependencies: { "@hasna-internal/bar": "0.1.0" } });
  writeMember(badRoot, "leaks-peer", { peerDependencies: { "@hasna-internal/baz": "0.1.0" } });
  writeMember(badRoot, "leaks-optional", { optionalDependencies: { "@hasna-internal/qux": "0.1.0" } });

  const badRes = checkDependencies(badRoot);
  check("seeded @hasna-internal dep in dependencies FIRES", badRes.violations.length === 4);
  check("violations name the member, field and dep", badRes.violations.every((v) => v.includes("leaks-") && v.includes("declares private-scope dependency")));

  // Good tree: public @hasna/* member deps, public non-@hasna hasna-org
  // scopes, and third-party scopes must ALL stay silent.
  const goodRoot = path.join(tmp, "good");
  fs.mkdirSync(goodRoot, { recursive: true });
  fs.writeFileSync(
    path.join(goodRoot, "package.json"),
    JSON.stringify({ name: "@hasna/apps", private: true, workspaces: ["apps/*"] }, null, 2),
  );
  writeMember(goodRoot, "foo", {
    dependencies: {
      "@hasna/todos": "0.15.0", // public member dep
      "@hasnaxyz/public": "0.1.0", // public non-@hasna hasna-org scope
      "@aws-sdk/client-s3": "3.0.0", // public third-party scope
      "zod": "3.25.0", // unscoped public package
    },
    devDependencies: {
      "@types/node": "26.0.0", // public third-party types scope
    },
  });
  const goodRes = checkDependencies(goodRoot);
  check("clean member (public @hasna, @hasnaxyz, @aws-sdk, @types, unscoped) stays SILENT", goodRes.count === 1 && goodRes.violations.length === 0);

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
