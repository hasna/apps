import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  SEMVER,
  REPOSITORY_ROOT,
  changedPackageVersions,
  discoverMembers,
  homeBunfigPath,
  readLatestChangelogVersion,
  readPendingChangesets,
  readStaticRuntimeVersions,
  readVersionFiles,
  readWorkspaceReferences,
  parseBunfigExcludes,
  rewriteWorkspaceRange,
} from "./helpers";

const members = discoverMembers();
const membersByName = new Map(members.map((member) => [member.name, member]));

// The changelog lane is STRICT (f05fe292 design, option b'): the release lane writes
// the CHANGELOG.md heading in the same commit as the version bump, so a mismatch here
// is a defect in the landing commit, not a record to be maintained. The former
// KNOWN_CHANGELOG_MISMATCHES exception map is DELETED — it existed only as a ledger
// for the release lane's missing heading step and could never converge on a moving
// main (measured: record half-life ~2.5h, review cycle > 2.5h).

// Literal runtime version exports are a different class: a hand-written constant in
// source, not a release-lane ledger. Verified live at this change (2026-08-15,
// main 5957da4ee): catalog 0.2.0/0.1.0 and treasury 0.1.1/0.1.0 still fire and both
// records still match, so the map is kept.
const KNOWN_RUNTIME_MISMATCHES = new Map([
  ["@hasna/catalog", { packageVersion: "0.2.0", runtimeVersion: "0.1.0" }],
  ["@hasna/treasury", { packageVersion: "0.1.1", runtimeVersion: "0.1.0" }],
]);

// The npm-parity keyspace is a REPORTING lane (f05fe292 design, option (a)): registry
// and main are two independent writers (publishes from other repos vs imports into
// this one), so no commit in this repo can hold the invariant. Live drift auto-files
// a reconcile task keyed on the exact fingerprint title "Reconcile @hasna/<pkg> main
// <m> vs npm <r>" (find-or-create via `todos task upsert`, deduped by fingerprint),
// prints the two-sided report, and never fails the lane. The former KNOWN_NPM_DRIFT
// map is DELETED: it was always stale within minutes (5 drifts recorded and 2 stale
// in one review cycle, measured 2026-08-14).
const RECONCILE_TASKS_PROJECT = process.env.VERSIONING_TODOS_PROJECT ?? "5e44770b-694c-46a3-864f-20a2b9ec1de2";

// Created reconcile tasks carry the documented lane identity agent-ea via
// --assign/--assign-seat (agent-ea is a durable seat), independent of the
// ambient TODOS_AGENT_ID; override with VERSIONING_TODOS_AGENT.
const RECONCILE_TASKS_AGENT = process.env.VERSIONING_TODOS_AGENT ?? "agent-ea";

async function ensureReconcileTask(title: string, description: string): Promise<{ id: string; created: boolean } | null> {
  const proc = Bun.spawn(
    ["todos", "task", "upsert", "--fingerprint", title, "--title", title, "-d", description, "-p", "high", "--project", RECONCILE_TASKS_PROJECT, "--assign", RECONCILE_TASKS_AGENT, "--assign-seat", "--json"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    console.info(`[INFO versioning] reconcile task upsert failed for "${title}": ${stderr.trim().slice(0, 240)}`);
    return null;
  }
  try {
    const parsed = JSON.parse(stdout.trim()) as { task?: { id?: string }; created?: boolean };
    if (!parsed.task?.id) return null;
    return { id: parsed.task.id, created: parsed.created === true };
  } catch {
    return null;
  }
}

describe("hasna/apps versioning integrity", () => {
  test("discovers every direct publishable member with a semver package version", () => {
    expect(members.length).toBeGreaterThan(0);
    expect(new Set(members.map((member) => member.name)).size).toBe(members.length);
    for (const member of members) {
      expect(member.name).toMatch(/^@hasna\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(member.version).toMatch(SEMVER);
    }
  });

  test("pending changesets are non-empty, member-scoped, and release-backed", () => {
    const changesets = readPendingChangesets();
    expect(changesets.length).toBeGreaterThan(0);
    for (const changeset of changesets) {
      expect(changeset.packages.size).toBeGreaterThan(0);
      expect(changeset.body.trim().length).toBeGreaterThan(0);
      for (const [packageName, bump] of changeset.packages) {
        expect(membersByName.has(packageName)).toBe(true);
        expect(["major", "minor", "patch", "none"]).toContain(bump);
      }
    }
  });

  test("a package.json version change is accompanied by a changeset", () => {
    const changed = changedPackageVersions();
    if (changed === null) {
      console.info("[SKIP versioning] unable to resolve VERSIONING_BASE_REF for diff-backed changeset check");
      return;
    }
    const changedPackages = new Set(readPendingChangesets().flatMap((changeset) => [...changeset.packages.keys()]));
    const unbacked = [...changed.keys()].filter((directoryName) => {
      const member = members.find((candidate) => candidate.directory === join(REPOSITORY_ROOT, "apps", directoryName));
      return member !== undefined && !changedPackages.has(member.name);
    });
    expect(unbacked).toEqual([]);
  });

  test("workspace references are member-bound and have a deterministic npm rewrite", () => {
    const references = readWorkspaceReferences(members);
    console.info(
      `[INFO versioning] workspace references: ${references.length === 0 ? "none" : references.map((ref) => `${ref.member.name}:${ref.dependency}=${ref.range}`).join(", ")}`,
    );
    for (const reference of references) {
      const target = membersByName.get(reference.dependency);
      expect(target, `${reference.member.name} references non-member ${reference.dependency}`).toBeDefined();
      expect(rewriteWorkspaceRange(reference.range, target!.version)).not.toContain("workspace:");
    }
    expect(rewriteWorkspaceRange("workspace:*", "1.2.3")).toBe("1.2.3");
    expect(rewriteWorkspaceRange("workspace:^", "1.2.3")).toBe("^1.2.3");
    expect(rewriteWorkspaceRange("workspace:~", "1.2.3")).toBe("~1.2.3");
  });

  test("changelog release headings match package versions (strict)", () => {
    const mismatches = members.flatMap((member) => {
      const changelogVersion = readLatestChangelogVersion(member);
      return changelogVersion && changelogVersion !== member.version ? [{ name: member.name, packageVersion: member.version, changelogVersion }] : [];
    });
    if (mismatches.length > 0) console.info(`[INFO versioning] changelog mismatches: ${JSON.stringify(mismatches)}`);
    expect(mismatches).toEqual([]);
  });

  test("literal runtime version exports match package versions", () => {
    const mismatches = members.flatMap((member) => {
      const versions = readVersionFiles(member).flatMap((file) => readStaticRuntimeVersions(file));
      if (versions.length === 0 || versions.includes(member.version)) return [];
      return [{ name: member.name, packageVersion: member.version, runtimeVersions: versions }];
    });
    const unexpected = mismatches.filter((mismatch) => {
      const known = KNOWN_RUNTIME_MISMATCHES.get(mismatch.name);
      return !known || known.packageVersion !== mismatch.packageVersion || !mismatch.runtimeVersions.includes(known.runtimeVersion);
    });
    if (mismatches.length > 0) console.info(`[INFO versioning] known runtime mismatches: ${JSON.stringify(mismatches)}`);
    expect(unexpected).toEqual([]);
  });

  test("quarantine excludes cover all members, informational by default", () => {
    const excludes = parseBunfigExcludes(homeBunfigPath());
    const missing = members.map((member) => member.name).filter((name) => !excludes.has(name));
    if (missing.length > 0) console.info(`[INFO versioning] new package names needing quarantine excludes: ${missing.join(", ")}`);
    if (process.argv.includes("--strict") || process.env.VERSIONING_STRICT === "1") expect(missing).toEqual([]);
  });
});

describe("npm latest parity (opt-in network reporting lane)", () => {
  const enabled = process.env.VERSIONING_NPM_PARITY === "1";
  const sample = (process.env.VERSIONING_NPM_SAMPLE ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const selected = sample.length > 0 ? members.filter((member) => sample.includes(member.name)) : members;

  test.skipIf(!enabled)("reports npm latest drift against main versions and auto-files reconcile tasks", async () => {
    const unknownSample = sample.filter((name) => !membersByName.has(name));
    expect(unknownSample, "VERSIONING_NPM_SAMPLE contains unknown member names").toEqual([]);
    expect(selected.length, "VERSIONING_NPM_SAMPLE selected no members").toBeGreaterThan(0);
    const drifts: Array<{ name: string; registry: string; main: string; taskId: string | null; created: boolean | null }> = [];
    const anomalies: Array<{ name: string; error: string }> = [];
    for (const member of selected) {
      const proc = Bun.spawn(["npm", "view", member.name, "version", "--json", "--fetch-timeout=5000", "--fetch-retries=0"], {
        cwd: REPOSITORY_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (exitCode !== 0) {
        const networkFailure = /EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENOTFOUND/i.test(stderr);
        if (networkFailure || process.env.VERSIONING_NPM_OFFLINE === "1") {
          console.info(`[SKIP versioning] npm parity unavailable for ${member.name}; offline/network route`);
          return;
        }
        anomalies.push({ name: member.name, error: stderr.trim().slice(0, 240) });
        continue;
      }
      const registryVersion = JSON.parse(stdout.trim()) as unknown;
      if (registryVersion === member.version) continue;
      const fingerprintTitle = `Reconcile @hasna/${member.name.replace(/^@hasna\//, "")} main ${member.version} vs npm ${String(registryVersion)}`;
      const description = `Parity lane (test/versioning, VERSIONING_NPM_PARITY=1) measured registry ${String(registryVersion)} vs main ${member.version}. Acceptance: the sides converge (main catches up to the registry, or the registry is corrected), then this lane reports no drift for this fingerprint; the task closes once the lane re-runs clean.`;
      const task = await ensureReconcileTask(fingerprintTitle, description);
      drifts.push({
        name: member.name,
        registry: String(registryVersion),
        main: member.version,
        taskId: task?.id ?? null,
        created: task ? task.created : null,
      });
    }
    const driftLines = drifts.map((d) => `  ${d.name}: main ${d.main} vs npm ${d.registry} -> reconcile task ${d.taskId ?? "NOT FILED (todos unavailable)"} (${d.created === null ? "n/a" : d.created ? "created" : "existing"})`);
    const anomalyLines = anomalies.map((a) => `  ${a.name}: npm view failed (${a.error})`);
    console.info(
      `[INFO versioning] npm/main parity report: ${drifts.length} drift(s), ${anomalies.length} instrument anomaly(ies)\n${driftLines.join("\n")}\n${anomalyLines.join("\n")}`,
    );
    if (drifts.length === 0 && anomalies.length === 0) console.info("[INFO versioning] npm/main parity report: clean — no drift, no anomalies");
  });
});
