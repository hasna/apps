import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SEMVER,
  REPOSITORY_ROOT,
  changedPackageVersions,
  consumedChangesetPackages,
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

function syntheticGit(command: string[], cwd: string): string {
  const result = Bun.spawnSync({ cmd: command, cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`synthetic git failed: ${command.join(" ")}\n${new TextDecoder().decode(result.stderr)}`);
  return new TextDecoder().decode(result.stdout);
}

// A changeset-consuming release diff (the `changeset version` output: package.json
// version bumps + CHANGELOG.md headings + the applied .changeset/*.md files DELETED)
// legitimately ships version bumps with no PENDING changeset — the changeset that
// accompanied the bump was consumed to produce it. Measured on hasna/apps#277
// (@hasna/prompts 0.3.33, 2026-08-17) and hasna/apps#154 (hooks 0.6.4): the test below
// ("a package.json version change is accompanied by a changeset") failed by
// construction on those release PRs. The two tests in this group pin the exemption
// detector against synthetic git repos: a release-shaped diff MUST be recognized
// (positive arm) and a plain unbacked bump MUST stay recognized as such (negative arm).
// The fixture's own branch is named EXPLICITLY (`git init -b`), never inherited from
// the machine: `git init` takes its initial branch from init.defaultBranch, so a
// fixture that later checks out a hardcoded "master" dies with `pathspec 'master' did
// not match any file(s)` on any machine configured for "main" — measured on station01
// (init.defaultBranch=main), where the base-moved-past-the-release test threw before
// it could assert anything. A thrown fixture is not a failing invariant; the branch
// name must be a fixture constant.
const FIXTURE_BRANCH = "fixture-head";

function releaseShapeRepo(): { dir: string; consumed: () => Map<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "versioning-release-shape-"));
  const git = (command: string[]) => syntheticGit(command, dir);
  git(["git", "init", "-q", "-b", FIXTURE_BRANCH]);
  git(["git", "config", "user.email", "test@example.com"]);
  git(["git", "config", "user.name", "versioning-test"]);
  // Machine git hooks (e.g. a global lefthook) add seconds per commit and make the
  // fixture non-hermetic; the synthetic repo needs no hooks.
  git(["git", "config", "core.hooksPath", "/dev/null"]);
  mkdirSync(join(dir, "apps", "pkg"), { recursive: true });
  mkdirSync(join(dir, ".changeset"), { recursive: true });
  writeFileSync(join(dir, "apps", "pkg", "package.json"), `${JSON.stringify({ name: "@hasna/pkg", version: "0.2.0" }, null, 2)}\n`);
  writeFileSync(join(dir, ".changeset", "release-1.md"), '---\n"@hasna/pkg": patch\n---\n\nRelease body\n');
  git(["git", "add", "-A"]);
  git(["git", "commit", "-qm", "base"]);
  git(["git", "branch", "base"]);
  return { dir, consumed: () => consumedChangesetPackages(dir, "base") };
}

function commitReleaseShape(dir: string, consume: boolean): void {
  const git = (command: string[]) => syntheticGit(command, dir);
  writeFileSync(join(dir, "apps", "pkg", "package.json"), `${JSON.stringify({ name: "@hasna/pkg", version: "0.2.1" }, null, 2)}\n`);
  if (consume) rmSync(join(dir, ".changeset", "release-1.md"));
  git(["git", "add", "-A"]);
  git(["git", "commit", "-qm", "release"]);
}

const members = discoverMembers();
const membersByName = new Map(members.map((member) => [member.name, member]));

// The changelog lane is STRICT (f05fe292 design, option b'): the release lane writes
// the CHANGELOG.md heading in the same commit as the version bump, so a mismatch here
// is a defect in the landing commit, not a record to be maintained. The former
// KNOWN_CHANGELOG_MISMATCHES exception map is DELETED — it existed only as a ledger
// for the release lane's missing heading step and could never converge on a moving
// main (measured: record half-life ~2.5h, review cycle > 2.5h).

// Literal runtime version exports are a different class from the deleted changelog
// ledger: a hand-written constant in source, not a release-lane artifact. So the
// EXEMPTION MECHANISM is kept — but it now carries no entries.
//
// Re-measured 2026-08-23, and both records were already dead: apps/catalog/src/version.ts
// exported VERSION "0.2.1" against package version 0.2.1 (aligned, no longer fired), and
// apps/treasury/src/version.ts exports `APP_VERSION = pkg.version` — derived, not
// a literal, so readStaticRuntimeVersions (which requires a same-line string literal)
// yields nothing for it and it cannot fire at all. apps/catalog was deleted from this
// repo 2026-09-03 (issue #1530), so the catalog side cannot recur in this tree either.
// An exemption that no longer matches its subject is a hole, not a record: it would
// silently pass exactly the catalog 0.2.0/0.1.0 drift it was written to document if
// that recurred. Empty is the honest state; a genuine future exemption is one line plus
// its measurement.
const KNOWN_RUNTIME_MISMATCHES = new Map<string, { packageVersion: string; runtimeVersion: string }>([]);

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
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(
      ["todos", "task", "upsert", "--fingerprint", title, "--title", title, "-d", description, "-p", "high", "--project", RECONCILE_TASKS_PROJECT, "--assign", RECONCILE_TASKS_AGENT, "--assign-seat", "--json"],
      { stdout: "pipe", stderr: "pipe" },
    );
  } catch (err) {
    // A missing `todos` executable throws at spawn time instead of exiting
    // non-zero; the reporting lane must never fail on a task-sync failure —
    // report NOT FILED and pass (measured on CI runners without the CLI).
    console.info(`[INFO versioning] reconcile task upsert unavailable for "${title}": ${(err as Error).message?.slice(0, 200)} — NOT FILED`);
    return null;
  }
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
    // EXEMPTION — changeset-consuming release PRs (measured hasna/apps#277 for
    // @hasna/prompts 0.3.33, hooks #154 precedent). The release lane bumps
    // package.json BECAUSE a changeset was consumed, so no new changeset accompanies
    // the bump by construction. `consumedChangesetPackages` reads the .changeset/*.md
    // files DELETED in this same diff (base...HEAD) from the base ref and treats the
    // packages they named as accompanied: the changeset that backed the bump is in the
    // diff, consumed rather than pending. A plain unbacked bump deletes nothing under
    // .changeset/ and stays red (negative arm pinned below).
    const releaseBacked = consumedChangesetPackages();
    const unbacked = [...changed.keys()].filter((directoryName) => {
      const member = members.find((candidate) => candidate.directory === join(REPOSITORY_ROOT, "apps", directoryName));
      return member !== undefined && !changedPackages.has(member.name) && !releaseBacked.has(member.name);
    });
    expect(unbacked).toEqual([]);
  });

  test("a release-shaped diff (bump + consumed changeset) is recognized as backed", () => {
    const { dir, consumed } = releaseShapeRepo();
    try {
      commitReleaseShape(dir, true);
      const backed = consumed();
      expect(backed.get("@hasna/pkg")).toBe("release-1.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a plain unbacked bump deletes nothing under .changeset/ and is not exempted", () => {
    const { dir, consumed } = releaseShapeRepo();
    try {
      commitReleaseShape(dir, false);
      expect(consumed().size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a release-shaped diff stays recognized when the base moved past the release", () => {
    // The base ref (e.g. origin/main) can advance past a release BEFORE the exemption
    // lane re-runs against it: the release's .changeset deletions then sit on BOTH
    // sides of the three-dot diff, so the consumed files are no longer readable from
    // the base ref itself. The detector must read them from the merge-base, which
    // still holds them. Measured live 2026-08-18: hasna/apps#277's head (prompts
    // 0.3.33) against an origin/main that had already absorbed the release (the
    // squash-merge equivalent: the base side carries the same bump + consumption in
    // its own commit, neither side an ancestor of the other).
    const { dir, consumed } = releaseShapeRepo();
    try {
      commitReleaseShape(dir, true);
      const git = (command: string[]) => syntheticGit(command, dir);
      git(["git", "checkout", "-q", "base"]);
      writeFileSync(join(dir, "apps", "pkg", "package.json"), `${JSON.stringify({ name: "@hasna/pkg", version: "0.2.1" }, null, 2)}\n`);
      rmSync(join(dir, ".changeset", "release-1.md"));
      git(["git", "add", "-A"]);
      git(["git", "commit", "-qm", "base absorbs release"]);
      git(["git", "checkout", "-q", FIXTURE_BRANCH]);
      const backed = consumed();
      expect(backed.get("@hasna/pkg")).toBe("release-1.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  test("no member exact-pins @hasna/contracts one patch behind the in-tree version (wave-miss shape)", () => {
    // The ship-latest version wave bumps @hasna/contracts by one patch and aligns the
    // pins of every consumer released in that wave. A member whose exact pin sits
    // EXACTLY ONE PATCH behind the in-tree contracts version is the wave-miss shape:
    // it was aligned by the wave and then reverted by a release lane's interim re-pin
    // to the then-published version, with no later release re-aligning it. Measured:
    // hasna/apps#861 re-pinned @hasna/calendar to contracts 0.13.3 after wave #856
    // aligned it to 0.13.4 (0.13.4 was not yet on the registry at #861's moment —
    // correct then), and the registry advance to 0.13.4 was never picked up by
    // calendar's next release — the reported defect (row 2ce5505f, T-00097).
    // Members two or more versions behind are deliberate per-release registry pins
    // (the frozen-locks gate's EXCEPTIONS rationale, e.g. actions 0.11.1, billing
    // 0.9.0), NOT this class; a `^`/`~` range resolves forward on the registry and
    // is not this class either.
    const contracts = membersByName.get("@hasna/contracts");
    expect(contracts, "@hasna/contracts is a member of this tree").toBeDefined();
    const [major, minor, patch] = contracts!.version.split(".").map(Number);
    if (![major, minor, patch].every(Number.isInteger)) {
      console.info("[SKIP versioning] @hasna/contracts version is not plain numeric semver; wave-miss pin check skipped");
      return;
    }
    const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
    const waveMiss = members.flatMap((member) => {
      return sections.flatMap((section) => {
        const deps = member.manifest[section];
        if (!deps || typeof deps !== "object" || Array.isArray(deps)) return [];
        const range = deps["@hasna/contracts"];
        if (typeof range !== "string") return [];
        const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(range);
        if (!match) return [];
        const pinMajor = Number(match[1]);
        const pinMinor = Number(match[2]);
        const pinPatch = Number(match[3]);
        if (pinMajor === major && pinMinor === minor && pinPatch === patch - 1) {
          return [{ member: member.name, pin: range, inTree: contracts!.version }];
        }
        return [];
      });
    });
    if (waveMiss.length > 0) {
      console.info(
        `[INFO versioning] @hasna/contracts wave-miss pins: ${waveMiss.map((w) => `${w.member} pins ${w.pin} vs in-tree ${w.inTree}`).join(", ")}`,
      );
    }
    expect(waveMiss).toEqual([]);
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
