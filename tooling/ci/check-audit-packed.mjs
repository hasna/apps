#!/usr/bin/env bun
/**
 * Audit the member's SHIPPED dependency surface, not the workspace lockfile.
 *
 * Why this exists (todos be6817f3): in a bun workspace, `bun audit` run from any
 * member directory resolves against the MONOREPO bun.lock and reports every member's
 * dependency closure (workspace: and workspace-transitive: entries) plus the member's
 * own. A member's publish gate therefore failed on OTHER members' advisories that never
 * ship in its tarball — a never-passing gate for every @hasna/* package since the
 * monorepo migration. bun audit has no member-scope flag; `bun audit --production`
 * does not scope to the member either (measured rc=1, still lists other members'
 * closures).
 *
 * What this script does instead — consumer semantics:
 *   1. pack the member (`bun pm pack --ignore-scripts`, same pack pattern as
 *      apps/loops/scripts/check-packed-boundary.mjs);
 *   2. create a scratch probe directory with a minimal package.json and install the
 *      tarball into it (`bun add <tarball>` — installs the tarball's dependencies and
 *      optionalDependencies only, exactly what a consumer installing the published
 *      artifact would run);
 *   3. run `bun audit` in the probe directory and propagate its exit code;
 *   4. cleanup in a finally block.
 *
 * The gate remains a check that can fail: any advisory in the member's own shipped
 * closure fails the audit at the member's own publish time, which is the correct
 * enforcement point. There is no blanket disable, no --ignore CVE allowlist, and no
 * --audit-level lowering.
 *
 * Known edge (recorded deliberately): the probe resolves ranges at registry time, so
 * the fleet 7-day minimumReleaseAge quarantine applies — a dependency publishing a
 * brand-new version would fail the probe install closed (fail-closed, safe direction;
 * the sanctioned per-package minimumReleaseAgeExcludes entry is the only mitigation and
 * must never be lowered).
 *
 * Test-only injection: AUDIT_PROBE_EXTRA_DEPS=<spec> [<spec>...] adds extra packages to
 * the probe install. Used by the two-sided regression to prove the gate still fails on
 * a genuine advisory (tooling/ci/tests/standard/check-audit-packed.test.mjs).
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const memberRoot = process.cwd();
const extraDeps = (process.env.AUDIT_PROBE_EXTRA_DEPS ?? "").trim();

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300_000 });
  if (result.error) {
    process.stderr.write(`error: ${command} ${args.join(" ")} failed to run: ${result.error.message}\n`);
    process.exit(2);
  }
  return result;
}

const scratch = mkdtempSync(join(tmpdir(), "audit-packed-"));
let exitCode = 2;
try {
  const pack = run("bun", ["pm", "pack", "--destination", scratch, "--ignore-scripts", "--quiet"], memberRoot);
  if (pack.status !== 0) {
    process.stderr.write(pack.stdout);
    process.stderr.write(pack.stderr);
    process.stderr.write(`error: bun pm pack failed for ${memberRoot} (rc=${pack.status})\n`);
    process.exit(2);
  }

  const archiveName = readdirSync(scratch).find((entry) => entry.endsWith(".tgz"));
  if (!archiveName) {
    process.stderr.write(`error: bun pm pack did not produce a tarball in ${scratch}\n`);
    process.exit(2);
  }
  const tarball = join(scratch, archiveName);

  const probe = join(scratch, "probe");
  mkdirSync(probe);
  writeFileSync(
    join(probe, "package.json"),
    JSON.stringify({ name: "audit-packed-probe", version: "0.0.0", private: true }, null, 2) + "\n",
  );

  const specs = [tarball, ...(extraDeps ? extraDeps.split(/\s+/) : [])];
  const add = run("bun", ["add", ...specs], probe);
  if (add.status !== 0) {
    process.stderr.write(add.stdout);
    process.stderr.write(add.stderr);
    process.stderr.write(
      `error: probe install of ${tarball} failed (rc=${add.status}). ` +
        `This fails the gate closed — a dependency resolving to a brand-new version under ` +
        `the 7-day minimumReleaseAge quarantine is the known cause (see header comment).\n`,
    );
    process.exit(2);
  }

  const audit = run("bun", ["audit"], probe);
  process.stdout.write(audit.stdout);
  process.stderr.write(audit.stderr);
  exitCode = audit.status ?? 2;
  if (exitCode !== 0) {
    process.stderr.write(
      `error: audit of the packed member surface failed (rc=${exitCode}). ` +
        `An advisory reached what a consumer installing this tarball would run; fix the ` +
        `member's shipped dependency closure before publishing.\n`,
    );
  } else {
    process.stdout.write(`Packed member surface audit clean for ${memberRoot}\n`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);
