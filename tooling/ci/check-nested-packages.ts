/**
 * Nested-package gate — refuse a nested package.json that declares a
 * publishable `@hasna/*` name (a split `-sdk`/`-mcp`/… package).
 *
 * Usage:
 *   bun tooling/ci/check-nested-packages.ts [--root <dir>]     # refuse (exit 1) on violations
 *   bun tooling/ci/check-nested-packages.ts --report [--root]   # report-only (exit 0), the landing mode
 *   bun tooling/ci/check-nested-packages.ts --self-test
 *
 * The rule, families and measurement live in ./nested-packages.ts, shared
 * with tooling/ci/tests/standard/nested-packages.test.ts so the gate and the
 * suite cannot disagree. Report mode exists so the gate can land while the
 * measured split packages (@hasna/connectors-sdk, @hasna/todos-sdk,
 * @hasna/todos-ai) are folded by their owners; drop `--report` in ci.yml to
 * make it hard.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NESTED_FAMILIES, formatViolation, nestedPackageViolations, staleFamilies, type NestedFamily } from "./nested-packages";

function run(root: string, reportOnly: boolean, families: NestedFamily[] = NESTED_FAMILIES): number {
  const violations = nestedPackageViolations(root, families);
  const stale = staleFamilies(root, families);
  for (const f of stale) console.error(`NESTED-PACKAGE STALE FAMILY: ${f.member} ${f.file} matches no manifest — delete the family entry`);
  if (violations.length === 0) {
    console.log(`nested-package gate: 0 nested publishable @hasna/* packages outside the recorded catalog families`);
    return stale.length > 0 ? 1 : 0;
  }
  const label = reportOnly ? "NESTED-PACKAGE REPORT (report-only; not refused yet)" : "NESTED-PACKAGE VIOLATIONS";
  const log = reportOnly ? console.log : console.error;
  log(`${label} (${violations.length}):`);
  for (const v of violations) log(`  ${formatViolation(v)}`);
  if (stale.length > 0) return 1;
  return reportOnly ? 0 : 1;
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hasna-apps-nested-"));
  try {
    const root = path.join(tmp, "repo");
    const write = (rel: string, pkg: unknown) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
    };
    write("package.json", { name: "@hasna/apps", private: true, workspaces: ["apps/*"] });
    write("apps/foo/package.json", { name: "@hasna/foo" });
    write("apps/foo/sdk/package.json", { name: "@hasna/foo-sdk" }); // split -> fires
    write("apps/foo/ai/package.json", { name: "@hasna/foo-ai", private: true }); // private -> silent
    write("apps/foo/fixtures/x/package.json", { name: "not-scoped" }); // unscoped -> silent
    write("apps/foo/node_modules/@hasna/bar/package.json", { name: "@hasna/bar" }); // node_modules -> skipped
    write("apps/cat/package.json", { name: "@hasna/cat" });
    write("apps/cat/items/alpha/package.json", { name: "@hasna/item-alpha" }); // family, correct
    write("apps/cat/items/beta/package.json", { name: "@hasna/item-gamma" }); // family, mismatch -> fires
    const families: NestedFamily[] = [
      { member: "cat", file: /^apps\/cat\/items\/([a-z0-9-]+)\/package\.json$/, expectedName: (s) => `@hasna/item-${s}`, reason: "fixture catalog" },
      { member: "cat", file: /^apps\/cat\/gone\/([a-z0-9-]+)\/package\.json$/, expectedName: (s) => `@hasna/gone-${s}`, reason: "fixture stale family" },
    ];
    const v = nestedPackageViolations(root, families);
    check("split -sdk package fires", v.some((x) => x.file === "apps/foo/sdk/package.json" && x.kind === "split-package"));
    check("private nested package stays silent", !v.some((x) => x.file === "apps/foo/ai/package.json"));
    check("unscoped nested package stays silent", !v.some((x) => x.file.includes("fixtures/x")));
    check("node_modules is never scanned", !v.some((x) => x.file.includes("node_modules")));
    check("catalog family entry with the right name stays silent", !v.some((x) => x.file === "apps/cat/items/alpha/package.json"));
    check("catalog family entry with the wrong name fires", v.some((x) => x.file === "apps/cat/items/beta/package.json" && x.kind === "family-name-mismatch"));
    check("exactly 2 violations on the fixture", v.length === 2);
    check("a family that matches nothing is reported stale", staleFamilies(root, families).length === 1);
    check("refuse mode exits 1 on violations (and a stale family is refused in both modes)", run(root, false, families) === 1 && run(root, true, families) === 1);
    // Report mode on a tree with violations but NO stale family exits 0.
    const liveFamilies = families.slice(0, 1);
    check("report mode exits 0 on violations alone", nestedPackageViolations(root, liveFamilies).length === 2 && run(root, true, liveFamilies) === 0);
    // Clean tree: no nested @hasna manifests at all.
    const clean = path.join(tmp, "clean");
    fs.mkdirSync(path.join(clean, "apps", "foo"), { recursive: true });
    fs.writeFileSync(path.join(clean, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
    fs.writeFileSync(path.join(clean, "apps", "foo", "package.json"), JSON.stringify({ name: "@hasna/foo" }));
    check("clean tree passes in refuse mode (no families -> nothing stale)", nestedPackageViolations(clean, []).length === 0 && staleFamilies(clean, []).length === 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) {
    console.error("self-test FAILED — the gate cannot be trusted");
    return 1;
  }
  console.log("self-test: PASS (can fire AND stay silent)");
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest());
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args[rootIdx + 1]! : process.cwd();
process.exit(run(root, args.includes("--report")));
