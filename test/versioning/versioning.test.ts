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

// These are measured import/release-line mismatches on the 2026-08-14 main base.
// They are exceptions, not a general relaxation: a different value remains a failure.
const KNOWN_CHANGELOG_MISMATCHES = new Map([
  ["@hasna/calendar", { packageVersion: "0.3.1", changelogVersion: "0.3.0" }],
  ["@hasna/loops", { packageVersion: "0.4.42", changelogVersion: "0.4.41" }],
  ["@hasna/secrets", { packageVersion: "0.2.22", changelogVersion: "0.2.21" }],
  ["@hasna/signatures", { packageVersion: "0.1.14", changelogVersion: "0.1.12" }],
]);

const KNOWN_RUNTIME_MISMATCHES = new Map([
  ["@hasna/catalog", { packageVersion: "0.2.0", runtimeVersion: "0.1.0" }],
  ["@hasna/treasury", { packageVersion: "0.1.1", runtimeVersion: "0.1.0" }],
]);

// The pre-import census entries for apps/{economy,events,feedback,recordings} were
// pruned 2026-08-14 (reviewer P2): those packages are not members of this repo, so the
// entries could never fire. The @hasna/repos entry was pruned as inert: registry 0.1.46
// now equals main. Measured live: npm view @hasna/loops version --json -> "0.5.0".
const KNOWN_NPM_DRIFT = new Map([
  ["@hasna/loops", { registryVersion: "0.5.0", mainVersion: "0.4.42", source: "publish lane released 0.5.0 ahead of main; reconcile task 69e8b5dd-15cd-4f45-8739-c0edf6720773" }],
]);

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

  test("changelog release headings match package versions", () => {
    const mismatches = members.flatMap((member) => {
      const changelogVersion = readLatestChangelogVersion(member);
      return changelogVersion && changelogVersion !== member.version ? [{ name: member.name, packageVersion: member.version, changelogVersion }] : [];
    });
    const unexpected = mismatches.filter((mismatch) => {
      const known = KNOWN_CHANGELOG_MISMATCHES.get(mismatch.name);
      return !known || known.packageVersion !== mismatch.packageVersion || known.changelogVersion !== mismatch.changelogVersion;
    });
    if (mismatches.length > 0) console.info(`[INFO versioning] known changelog mismatches: ${JSON.stringify(mismatches)}`);
    expect(unexpected).toEqual([]);
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

describe("npm latest parity (opt-in network lane)", () => {
  const enabled = process.env.VERSIONING_NPM_PARITY === "1";
  const sample = (process.env.VERSIONING_NPM_SAMPLE ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const selected = sample.length > 0 ? members.filter((member) => sample.includes(member.name)) : members;

  test.skipIf(!enabled)("reports npm latest drift against main versions", async () => {
    const unknownSample = sample.filter((name) => !membersByName.has(name));
    expect(unknownSample, "VERSIONING_NPM_SAMPLE contains unknown member names").toEqual([]);
    expect(selected.length, "VERSIONING_NPM_SAMPLE selected no members").toBeGreaterThan(0);
    const exceptions: Array<Record<string, string>> = [];
    const failures: Array<Record<string, string>> = [];
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
        failures.push({ name: member.name, error: stderr.trim().slice(0, 240) });
        continue;
      }
      const registryVersion = JSON.parse(stdout.trim()) as unknown;
      if (registryVersion === member.version) continue;
      const known = KNOWN_NPM_DRIFT.get(member.name);
      if (known && known.registryVersion === registryVersion && known.mainVersion === member.version) {
        exceptions.push({ name: member.name, registry: String(registryVersion), main: member.version, source: known.source });
      } else {
        failures.push({ name: member.name, registry: String(registryVersion), main: member.version });
      }
    }
    if (exceptions.length > 0) console.info(`[INFO versioning] allowed npm/main drift: ${JSON.stringify(exceptions)}`);
    expect(failures).toEqual([]);
  });
});
