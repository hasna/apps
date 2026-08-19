/**
 * Deploy-lane gate for hasna/apps.
 *
 * GitHub Actions discovers workflows ONLY at the repo root `.github/workflows/`.
 * A `deploy*.yml` file nested under `apps/<member>/.github/workflows/` is a
 * SILENT DEAD LANE: it looks like a deploy lane, sits in a real repo, and can
 * never run. That is the defect this gate exists to stop recurring (todos
 * 9b1828c9): apps/skills shipped a full deploy pipeline at the nested path for
 * months while the live OIDC trust still pointed at the deleted hasna/skills
 * repo — two broken halves of one lane, each looking authoritative.
 *
 * Three rules, all hard:
 *
 *   RULE 1 — a nested `apps/<member>/.github/workflows/deploy*.yml` is a
 *   violation UNLESS the member is in the UNPORTED registry below. That
 *   registry names pre-existing unported lanes (imported with their standalone
 *   repos during the 2026-08 monorepo import) whose OIDC trusts still pin the
 *   standalone repo; porting each is its own task, not this gate's job. The
 *   registry is deliberate and attributable — a member is removed from it by
 *   the lane that ports it, which is exactly the moment the gate starts
 *   guarding it.
 *
 *   RULE 2 — a root `.github/workflows/deploy-<member>.yml` must scope its
 *   push trigger with `paths: [apps/<member>/**]` and must NOT coexist with a
 *   nested deploy workflow for the same member. Without the paths scoping, a
 *   push to ANY member in the monorepo fires that member's deploy; with a
 *   nested sibling, one lane has two sources and they drift.
 *
 *   RULE 3 — every member in the PORTED registry (its infra-live OIDC trust
 *   has been rewired to this repo) MUST have its root deploy workflow present.
 *   A deletion is the same failure as a move to the wrong path: the trust
 *   points here, the lane must exist here.
 *
 * The gate carries its own two-sided self-test (prove-it-can-fail): a nested
 * deploy.yml fixture must FAIL the gate, a clean root workflow fixture must
 * PASS it, and a missing ported lane must FAIL it. A gate whose patterns
 * cannot fire reports a clean tree, and a clean tree is exactly what success
 * looks like.
 *
 * Usage:
 *   bun tooling/ci/check-deploy-lanes.ts
 *   bun tooling/ci/check-deploy-lanes.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Members whose nested deploy workflow is a KNOWN pre-existing unported lane.
 * Measured 2026-08-18: each carries `apps/<name>/.github/workflows/deploy.yml`
 * imported from its standalone repo; each one's OIDC trust in the live account
 * still pins the standalone repo (e.g. `repo:hasna/attachments`), so moving
 * the file alone would create a lane that cannot authenticate. Removing a
 * member from this list is that member's porting lane, not this gate's job.
 */
const UNPORTED_NESTED_DEPLOY_LANES = new Set([
  "attachments",
  "mementos",
  "sessions",
]);

/**
 * Members whose deploy lane is PORTED: the infra-live OIDC trust for the app
 * now points at this monorepo (repo:hasna/apps:environment:production), so the
 * discoverable root workflow MUST exist here. A member enters this list in the
 * same change that rewires its trust.
 */
const PORTED_DEPLOY_LANES = new Set(["projects", "skills"]);

function memberDirs(root: string): string[] {
  const apps = path.join(root, "apps");
  if (!fs.existsSync(apps)) return [];
  return fs
    .readdirSync(apps, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(apps, e.name, "package.json")))
    .map((e) => e.name);
}

function nestedDeployWorkflows(root: string, member: string): string[] {
  const dir = path.join(root, "apps", member, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("deploy") && f.endsWith(".yml"))
    .map((f) => path.join("apps", member, ".github", "workflows", f));
}

function rootDeployWorkflows(root: string): { file: string; member: string }[] {
  const dir = path.join(root, ".github", "workflows");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("deploy-") && f.endsWith(".yml"))
    .map((f) => ({ file: path.join(".github", "workflows", f), member: f.slice("deploy-".length, -".yml".length) }));
}

/** Rule 2a: the push trigger of a root deploy-<member>.yml must carry paths: [apps/<member>/**]. */
function hasScopedPathsFilter(root: string, file: string, member: string): boolean {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const expected = `apps/${member}/**`;
  // The `paths` list may be spread over lines; require the exact expected
  // entry as a quoted token anywhere in the file. A workflow with no push
  // trigger at all (workflow_dispatch-only) passes — nothing auto-triggers.
  return content.includes(`"${expected}"`) || content.includes(`'${expected}'`);
}

function checkDir(
  root: string,
  opts: { unported?: Set<string>; ported?: Set<string> } = {},
): { violations: string[]; checked: number } {
  const unported = opts.unported ?? UNPORTED_NESTED_DEPLOY_LANES;
  const ported = opts.ported ?? PORTED_DEPLOY_LANES;
  const violations: string[] = [];
  let checked = 0;
  const members = memberDirs(root);

  // Rule 1: nested deploy workflows are silent dead lanes.
  for (const member of members) {
    const nested = nestedDeployWorkflows(root, member);
    if (nested.length === 0) continue;
    if (unported.has(member)) {
      console.log(
        `  note: ${member} nested deploy workflow is a registered unported lane (exception registry)`,
      );
      continue;
    }
    for (const f of nested) {
      violations.push(
        `${f}: deploy workflow at an undiscoverable path — GitHub Actions only reads .github/workflows/ at the repo root. Port it to .github/workflows/deploy-${member}.yml with a 'paths: [apps/${member}/**]' push filter.`,
      );
    }
  }

  // Rule 2: root deploy workflows must be path-scoped and single-sourced.
  const rootByMember = new Map<string, string>();
  for (const { file, member } of rootDeployWorkflows(root)) {
    checked++;
    rootByMember.set(member, file);
    const nested = nestedDeployWorkflows(root, member);
    if (nested.length > 0) {
      violations.push(
        `${file}: root deploy workflow coexists with nested ${nested.join(", ")} — one lane must have one source. Delete the nested copy.`,
      );
    }
    if (!hasScopedPathsFilter(root, file, member)) {
      violations.push(
        `${file}: push trigger is not scoped with paths: [apps/${member}/**] — an unscoped push deploy fires on every member's merge to main.`,
      );
    }
  }

  // Rule 3: a ported lane's root workflow must exist.
  for (const member of ported) {
    if (!rootByMember.has(member)) {
      violations.push(
        `.github/workflows/deploy-${member}.yml: MISSING — ${member} is a ported deploy lane (infra-live OIDC trust points at hasna/apps), so its discoverable root workflow must exist here.`,
      );
    }
  }

  return { violations, checked };
}

function selfTest(): boolean {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-deploy-lanes-"));
  const mk = (p: string, content: string) => {
    const full = path.join(tmp, p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  // Positive control A: a nested deploy workflow with no exception registration
  // MUST be a violation.
  mk("apps/beta/package.json", "{}");
  mk("apps/beta/.github/workflows/deploy.yml", "name: deploy\non:\n  push:\n    branches: [main]\n");

  // Positive control B: a root workflow WITHOUT the paths scoping MUST be a
  // violation (and its member is not in the ported registry, so no missing-lane
  // noise).
  mk(".github/workflows/deploy-gamma.yml", "name: deploy-gamma\non:\n  push:\n    branches: [main]\n");
  mk("apps/gamma/package.json", "{}");

  // Positive control C: a member in the PORTED registry with NO root workflow
  // MUST be a violation (the trust points at this repo; the lane must exist
  // here). Fixture-based so the self-test is hermetic — the real ported
  // registry names skills, so use a stub ported set naming the fixture member.
  const portedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-deploy-lanes-ported-"));
  fs.mkdirSync(path.join(portedTmp, "apps", "eta"), { recursive: true });
  fs.writeFileSync(path.join(portedTmp, "apps", "eta", "package.json"), "{}");
  const portedMissing = checkDir(portedTmp, { unported: new Set(), ported: new Set(["eta"]) });
  const firedMissingPorted = portedMissing.violations.some(
    (v) => v.includes(".github/workflows/deploy-eta.yml: MISSING"),
  );

  const positive = checkDir(tmp, { unported: new Set(), ported: new Set() });
  const firedNested = positive.violations.some((v) => v.includes("apps/beta/.github/workflows/deploy.yml"));
  const firedScoping = positive.violations.some((v) => v.includes("deploy-gamma.yml"));
  if (!firedNested || !firedScoping) {
    console.error(
      `self-test FAILED — nested deploy.yml (${firedNested}) or unscoped root workflow (${firedScoping}) did not fire`,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(portedTmp, { recursive: true, force: true });
    return false;
  }
  if (!firedMissingPorted) {
    console.error("self-test FAILED — ported lane missing rule did not fire against the fixture");
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(portedTmp, { recursive: true, force: true });
    return false;
  }

  // Negative control: the exact Projects root lane, registered as ported and
  // scoped to apps/projects/**, must stay silent.
  const cleanTmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-deploy-lanes-clean-"));
  fs.mkdirSync(path.join(cleanTmp, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(cleanTmp, "apps", "projects"), { recursive: true });
  fs.writeFileSync(path.join(cleanTmp, "apps", "projects", "package.json"), "{}");
  fs.writeFileSync(
    path.join(cleanTmp, ".github", "workflows", "deploy-projects.yml"),
    'name: deploy-projects\non:\n  push:\n    branches: [main]\n    paths: ["apps/projects/**"]\n',
  );
  const negative = checkDir(cleanTmp, {
    unported: new Set(),
    ported: new Set(["projects"]),
  });
  if (negative.violations.length > 0) {
    console.error("self-test FAILED — clean root workflow did not stay silent");
    console.error(negative.violations.join("\n"));
    fs.rmSync(cleanTmp, { recursive: true, force: true });
    return false;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(cleanTmp, { recursive: true, force: true });
  fs.rmSync(portedTmp, { recursive: true, force: true });
  return true;
}

if (process.argv.includes("--self-test")) {
  if (selfTest()) {
    console.log("deploy-lanes self-test: PASS (can fire AND stay silent)");
    process.exit(0);
  }
  process.exit(1);
}

const root = process.cwd();
const { violations, checked } = checkDir(root);
for (const v of violations) console.error(`  ${v}`);
if (violations.length > 0) {
  console.error(`deploy-lanes: FAIL — ${violations.length} violation(s), ${checked} root deploy workflow(s) checked`);
  process.exit(1);
}
console.log(`deploy-lanes: PASS — ${checked} root deploy workflow(s) checked, no undiscoverable deploy lanes`);
process.exit(0);
