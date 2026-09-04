// Two-sided regression for the packed-surface audit gate (tooling/ci/check-audit-packed.mjs).
//
// Background (todos be6817f3): the release gates previously ran `bun audit` from the
// member dir, which in a bun workspace resolves against the MONOREPO lockfile and reports
// every member's dependency closure (workspace: / workspace-transitive: entries). Those
// closures never ship in the member's tarball, so every member's publish gate failed on
// other members' advisories — a never-passing gate for every @hasna/* package.
//
// The gate must audit what the member actually SHIPS: the dependency closure a consumer
// gets by installing the packed tarball. check-audit-packed.mjs packs the member, installs
// the tarball into a scratch probe directory as a consumer would, and runs `bun audit`
// there, propagating the exit code.
//
// This test proves the gate is two-sided — it can pass AND it can fail:
//   positive arm: a member whose shipped surface is clean must pass (rc=0, "No
//                  vulnerabilities found");
//   negative arm: injecting a genuine advisory (cross-spawn@5.1.0, GHSA-3xgq-45jj-v275)
//                  via AUDIT_PROBE_EXTRA_DEPS must fail (rc=1, advisory named).
//
// Network note: the probe resolves dependencies from the registry (consumer semantics),
// so this test — like the gate itself — requires registry access. It fails closed when
// the registry or the bun quarantine (7-day minimumReleaseAge) blocks resolution.

import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(fileURLToPath(new URL("../../", import.meta.url)), "check-audit-packed.mjs");

function runFixtureMember(extraDeps) {
  const root = mkdtempSync(join(tmpdir(), "audit-packed-fixture-"));
  const member = join(root, "member");
  mkdirSync(member);
  writeFileSync(
    join(member, "package.json"),
    JSON.stringify(
      {
        name: "audit-packed-fixture-member",
        version: "1.0.0",
        description: "Deterministic fixture member for the packed-surface audit gate regression",
        private: true,
        dependencies: {
          commander: "^13.1.0",
        },
      },
      null,
      2,
    ),
  );
  const env = { ...process.env };
  if (extraDeps) {
    env.AUDIT_PROBE_EXTRA_DEPS = extraDeps;
  }
  const result = spawnSync("bun", ["run", script], {
    cwd: member,
    encoding: "utf8",
    env,
    timeout: 300_000,
  });
  rmSync(root, { recursive: true, force: true });
  return result;
}

// The gate itself grants the probe 300s (spawnSync timeout below); the outer
// bun-test budget must NOT be tighter, or the harness preempts the gate's own
// semantics (a registry-backed pack → install → audit round trip on a loaded
// worker outruns any small cap — the 5s default was timing out on both arms,
// e.g. 2026-09-04 post-lockfix CI). Mirror the gate's 300s budget exactly.
test("positive arm: clean shipped surface passes the packed audit (rc=0, no vulnerabilities)", () => {
  const result = runFixtureMember(undefined);
  expect(result.status).toBe(0);
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  expect(combined).toContain("No vulnerabilities found");
}, 300_000);

test("negative arm: genuine advisory injected into the shipped surface fails the gate (rc=1, GHSA-3xgq-45jj-v275)", () => {
  const result = runFixtureMember("cross-spawn@5.1.0");
  expect(result.status).toBe(1);
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  expect(combined).toContain("GHSA-3xgq-45jj-v275");
}, 300_000);
