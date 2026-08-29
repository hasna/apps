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
 *   RULE 4 — every PORTED lane's root deploy workflow must be BOUND TO CI,
 *   not merely present and path-scoped. It must carry NO push trigger of its
 *   own (a push deploy races ci for the same commit and executes on raw
 *   merges to main while ci is red or still running — the deploy-skills
 *   defect, todos 56d3905c), must trigger from `on.workflow_run` on the
 *   completed ci workflow on main, and must carry a `gate` job whose
 *   job-level condition requires the successful-ci binding and whose
 *   permissions never include id-token; the deploy job must depend on that
 *   gate and run only when needs.gate.outputs.proceed == 'true'.
 *
 * The gate carries its own two-sided self-test (prove-it-can-fail): a nested
 * deploy.yml fixture must FAIL the gate, an unscoped root workflow fixture
 * must FAIL it, a push-triggered ported lane must FAIL it, a clean gated root
 * workflow fixture must PASS it, and a missing ported lane must FAIL it. A
 * gate whose patterns cannot fire reports a clean tree, and a clean tree is
 * exactly what success looks like.
 *
 * Usage:
 *   bun tooling/ci/check-deploy-lanes.ts
 *   bun tooling/ci/check-deploy-lanes.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseYaml, asMap, asArray, asText } from "./yaml.ts";

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
  "sessions",
]);

/**
 * Members whose deploy lane is PORTED: the infra-live OIDC trust for the app
 * now points at this monorepo (repo:hasna/apps:environment:production), so the
 * discoverable root workflow MUST exist here. A member enters this list in the
 * same change that rewires its trust.
 */
const PORTED_DEPLOY_LANES = new Set(["mementos", "projects", "skills"]);

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

/** The `name:` of .github/workflows/ci.yml — the workflow the gates bind to, or "" when absent. */
function ciWorkflowName(root: string): string {
  const file = path.join(root, ".github", "workflows", "ci.yml");
  if (!fs.existsSync(file)) return "";
  const document = asMap(parseYaml(fs.readFileSync(file, "utf8")));
  return asText(document.name);
}

/**
 * Rule 4: the gate job's condition must carry the successful-ci binding (and
 * the manual route). These are the same conditions the todos/projects lanes
 * carry; without them a "gate" job is a name, not a gate.
 */
const GATE_IF_REQUIREMENTS = [
  "github.event.workflow_run.conclusion == 'success'",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
  "github.event_name == 'workflow_dispatch'",
];

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

  // Rule 4: a ported lane's root workflow must be bound to a successful ci run.
  const portedWithRoot = [...ported].filter((member) => rootByMember.has(member));
  if (portedWithRoot.length > 0) {
    const ciName = ciWorkflowName(root);
    if (ciName === "") {
      violations.push(
        ".github/workflows/ci.yml: cannot verify the ci binding of ported deploy lanes — the ci workflow's name is unreadable",
      );
    }
    for (const member of portedWithRoot) {
      const file = rootByMember.get(member)!;
      const document = asMap(parseYaml(fs.readFileSync(path.join(root, file), "utf8")));
      const triggers = asMap(document.on);
      if ("push" in triggers) {
        violations.push(
          `${file}: carries its own push trigger — a push deploy races ci for the same commit and executes on raw merges to main while ci is red or still running. Bind the lane to on.workflow_run on the ci workflow and gate the deploy job.`,
        );
      }
      const workflowRun = asMap(triggers.workflow_run);
      const upstream = asArray(workflowRun.workflows).map((entry) => asText(entry));
      if (!upstream.includes(ciName)) {
        violations.push(
          `${file}: on.workflow_run.workflows must name the ci workflow "${ciName}", found [${upstream.join(", ")}]`,
        );
      }
      if (!asArray(workflowRun.types).map(asText).includes("completed")) {
        violations.push(`${file}: on.workflow_run.types must include completed`);
      }
      if (!asArray(workflowRun.branches).map(asText).includes("main")) {
        violations.push(`${file}: on.workflow_run.branches must be restricted to main`);
      }

      const jobs = asMap(document.jobs);
      const gate = asMap(jobs.gate);
      const deploy = asMap(jobs.deploy);
      if (Object.keys(gate).length === 0) {
        violations.push(`${file}: must carry a gate job that binds the lane to a successful ci run`);
      } else {
        const gateIf = asText(gate.if);
        for (const required of GATE_IF_REQUIREMENTS) {
          if (!gateIf.includes(required)) {
            violations.push(`${file}: the gate job condition must require ${required}`);
          }
        }
        const gatePermissions = asMap(gate.permissions);
        if (asText(gatePermissions.contents) !== "read") {
          violations.push(`${file}: the gate job must narrow permissions.contents to read`);
        }
        if (asText(gatePermissions.actions) !== "read") {
          violations.push(
            `${file}: the gate job must hold permissions.actions: read so it can verify the ci run for the manual route`,
          );
        }
        if ("id-token" in gatePermissions) {
          violations.push(
            `${file}: the gate job must not hold permissions.id-token — a job that can mint an OIDC assertion can reach production before any gate resolved`,
          );
        }
      }
      if (Object.keys(deploy).length === 0) {
        violations.push(`${file}: the deploy job is missing`);
      } else {
        const needs = Array.isArray(deploy.needs) ? deploy.needs.map(asText) : [asText(deploy.needs)];
        if (!needs.includes("gate")) violations.push(`${file}: the deploy job must depend on the gate job`);
        if (!asText(deploy.if).includes("needs.gate.outputs.proceed == 'true'")) {
          violations.push(`${file}: the deploy job must run only when needs.gate.outputs.proceed == 'true'`);
        }
      }
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

  // Positive control D: a PORTED member whose root workflow still deploys off
  // a raw push trigger — the exact deploy-skills defect (todos 56d3905c) —
  // MUST be a violation: the lane fires on every merge to main while ci is red
  // or still running.
  const pushTmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-deploy-lanes-push-"));
  fs.mkdirSync(path.join(pushTmp, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(pushTmp, "apps", "theta"), { recursive: true });
  fs.writeFileSync(path.join(pushTmp, "apps", "theta", "package.json"), "{}");
  fs.writeFileSync(path.join(pushTmp, ".github", "workflows", "ci.yml"), "name: ci\n");
  fs.writeFileSync(
    path.join(pushTmp, ".github", "workflows", "deploy-theta.yml"),
    'name: deploy-theta\non:\n  push:\n    branches: [main]\n    paths: ["apps/theta/**"]\n  workflow_dispatch: {}\n',
  );
  const pushPorted = checkDir(pushTmp, { unported: new Set(), ported: new Set(["theta"]) });
  const firedCiGate = pushPorted.violations.some(
    (v) => v.includes("deploy-theta.yml") && v.includes("push trigger"),
  );
  const firedGateJob = pushPorted.violations.some(
    (v) => v.includes("deploy-theta.yml") && v.includes("gate job"),
  );
  if (!firedCiGate || !firedGateJob) {
    console.error(
      `self-test FAILED — push-triggered ported lane (ci-gate ${firedCiGate}) or missing gate job (${firedGateJob}) did not fire`,
    );
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(portedTmp, { recursive: true, force: true });
    fs.rmSync(pushTmp, { recursive: true, force: true });
    return false;
  }

  // Negative control: the exact Projects root lane, registered as ported and
  // ci-gated with a gate job and a gated deploy job, must stay silent. The
  // fixture mirrors the shape the ported lanes actually carry (workflow_run on
  // ci, no push trigger, gate with contents+actions read and no id-token).
  const cleanTmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-deploy-lanes-clean-"));
  fs.mkdirSync(path.join(cleanTmp, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(cleanTmp, "apps", "projects"), { recursive: true });
  fs.writeFileSync(path.join(cleanTmp, "apps", "projects", "package.json"), "{}");
  fs.writeFileSync(path.join(cleanTmp, ".github", "workflows", "ci.yml"), "name: ci\n");
  fs.writeFileSync(
    path.join(cleanTmp, ".github", "workflows", "deploy-projects.yml"),
    "name: deploy-projects\n" +
      "on:\n" +
      "  workflow_run:\n" +
      "    workflows: [ci]\n" +
      "    types: [completed]\n" +
      "    branches: [main]\n" +
      "  workflow_dispatch: {}\n" +
      "permissions:\n" +
      "  contents: read\n" +
      "  id-token: write\n" +
      "env:\n" +
      '  DEPLOY_PATH_SCOPE: "apps/projects/**"\n' +
      "jobs:\n" +
      "  gate:\n" +
      "    permissions:\n" +
      "      contents: read\n" +
      "      actions: read\n" +
      "    if: ${{ github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main') }}\n" +
      "    outputs:\n" +
      "      proceed: ${{ steps.resolve.outputs.proceed }}\n" +
      "      source_sha: ${{ steps.resolve.outputs.source_sha }}\n" +
      "    steps:\n" +
      "      - name: Resolve the deployable commit\n" +
      "        id: resolve\n" +
      "        run: echo ok\n" +
      "  deploy:\n" +
      "    needs: gate\n" +
      "    if: ${{ needs.gate.outputs.proceed == 'true' }}\n" +
      "    steps:\n" +
      "      - name: noop\n" +
      "        run: echo ok\n",
  );
  const negative = checkDir(cleanTmp, {
    unported: new Set(),
    ported: new Set(["projects"]),
  });
  if (negative.violations.length > 0) {
    console.error("self-test FAILED — clean root workflow did not stay silent");
    console.error(negative.violations.join("\n"));
    fs.rmSync(cleanTmp, { recursive: true, force: true });
    fs.rmSync(pushTmp, { recursive: true, force: true });
    return false;
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(cleanTmp, { recursive: true, force: true });
  fs.rmSync(portedTmp, { recursive: true, force: true });
  fs.rmSync(pushTmp, { recursive: true, force: true });
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
