// Regression suite for the fixture-git false-NO_GO generator (todos 8331d1b0).
//
// WHAT HAPPENED (measured 2026-08-01, station01/station02, git 2.43.0). The
// scanner's history tests commit a synthetic credential into a throwaway repo
// in tmpdir, because scanning git history for credentials is the capability
// under test. The Hasna fleet installs a global core.hooksPath whose pre-commit
// hook refuses any staged credential, so it refused that fixture commit, on
// every fleet machine, on every branch. Two tests failed with
// "BLOCKED: credential pattern found in staged changes".
//
// The red tests were the cheap half of the damage. The expensive half is that
// the failure text names a credential leak, so a reviewer running the suite on
// an unrelated PR reads it as THAT PR having leaked one. It had not. Every
// reviewer touching this repo had to re-derive that independently.
//
// WHAT THESE TESTS PIN. The fixture repo must be hermetic STRUCTURALLY, not by
// the machine happening to be configured a particular way:
//   1. ambient config cannot arm a hook inside the fixture repo — through the
//      global config FILE, or through either env channel that injects config
//      keys on top of every file;
//   2. ambient env cannot REDIRECT the fixture at a different repository;
//   3. the real guard still guards — hermeticity is scoped to one invocation
//      and disarms nothing for anyone else.
//
// EVERY assertion here carries its own positive control: each case first proves
// the hostile fixture actually blocks a NON-hermetic invocation, and only then
// asserts the hermetic one succeeds. Without that pairing a passing test would
// be indistinguishable from a hook that never fired — which is precisely the
// shape of check this repo has been bitten by before.
//
// SAFETY: no real repository, no real hook and no real credential is involved.
// The "hook" is a two-line script in a mkdtemp directory that refuses
// everything; the credential is assembled from fragments at runtime and is not
// a live value.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermeticGitEnv, tryHermeticGit } from "./setup/hermetic-git.js";

/** Marker the fixture hook prints, so a block is identified rather than assumed. */
const HOOK_MARKER = "FIXTURE-HOOK-REFUSED-THIS-COMMIT";

let workspace: string;
let hooksDir: string;
let ambientConfig: string;
let repo: string;

/** git invoked the ordinary way: whatever the ambient environment says goes. */
function plainGit(
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** The three env shapes that each deliver core.hooksPath by a different route. */
function ambientViaConfigFile(): NodeJS.ProcessEnv {
  return { GIT_CONFIG_GLOBAL: ambientConfig };
}

function ambientViaIndexedEnv(): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooksDir,
  };
}

function ambientViaParametersEnv(): NodeJS.ProcessEnv {
  return { GIT_CONFIG_PARAMETERS: `'core.hooksPath'='${hooksDir}'` };
}

/** Stage a new file so each commit attempt has something to commit. */
function stage(name: string): void {
  writeFileSync(join(repo, name), `${name}\n`);
  expect(tryHermeticGit(["add", name], repo).status).toBe(0);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "secrets-hermetic-git-"));
  hooksDir = join(workspace, "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const preCommit = join(hooksDir, "pre-commit");
  writeFileSync(preCommit, `#!/bin/sh\necho "${HOOK_MARKER}" >&2\nexit 1\n`);
  chmodSync(preCommit, 0o755);

  ambientConfig = join(workspace, "ambient.gitconfig");
  writeFileSync(ambientConfig, `[core]\n\thooksPath = ${hooksDir}\n`);

  repo = join(workspace, "repo");
  mkdirSync(repo, { recursive: true });
  // Set up hermetically: identity lands in the repo-LOCAL config, which both
  // hermetic and plain invocations honour, so the controls below fail on the
  // hook rather than on a missing committer.
  expect(tryHermeticGit(["init", "--initial-branch", "main"], repo).status).toBe(0);
  expect(tryHermeticGit(["config", "user.name", "Hasna Secrets Fixture"], repo).status).toBe(0);
  expect(
    tryHermeticGit(["config", "user.email", "fixture@example.invalid"], repo).status,
  ).toBe(0);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("hermetic fixture git", () => {
  it("has a fixture hook that genuinely blocks a non-hermetic commit", () => {
    stage("control.txt");

    const blocked = plainGit(["commit", "-m", "control"], repo, ambientViaConfigFile());

    // If this ever passes, every other test in this file is vacuous.
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain(HOOK_MARKER);
  });

  it("neutralises a core.hooksPath delivered by the global config file", () => {
    stage("via-file.txt");
    expect(
      plainGit(["commit", "-m", "control"], repo, ambientViaConfigFile()).stderr,
    ).toContain(HOOK_MARKER);

    const hermetic = tryHermeticGit(["commit", "-m", "hermetic"], repo);

    expect(hermetic.stderr).not.toContain(HOOK_MARKER);
    expect(hermetic.status).toBe(0);
  });

  it("neutralises a core.hooksPath injected through GIT_CONFIG_COUNT", () => {
    stage("via-count.txt");
    // Pinning the config FILES is not enough on its own: this channel layers a
    // key on top of every file, /dev/null included.
    expect(
      plainGit(["commit", "-m", "control"], repo, ambientViaIndexedEnv()).stderr,
    ).toContain(HOOK_MARKER);

    const previousEnv = process.env;
    try {
      process.env = { ...previousEnv, ...ambientViaIndexedEnv() };
      const hermetic = tryHermeticGit(["commit", "-m", "hermetic"], repo);
      expect(hermetic.stderr).not.toContain(HOOK_MARKER);
      expect(hermetic.status).toBe(0);
    } finally {
      process.env = previousEnv;
    }
  });

  it("neutralises a core.hooksPath injected through GIT_CONFIG_PARAMETERS", () => {
    stage("via-parameters.txt");
    expect(
      plainGit(["commit", "-m", "control"], repo, ambientViaParametersEnv()).stderr,
    ).toContain(HOOK_MARKER);

    const previousEnv = process.env;
    try {
      process.env = { ...previousEnv, ...ambientViaParametersEnv() };
      const hermetic = tryHermeticGit(["commit", "-m", "hermetic"], repo);
      expect(hermetic.stderr).not.toContain(HOOK_MARKER);
      expect(hermetic.status).toBe(0);
    } finally {
      process.env = previousEnv;
    }
  });

  it("does not let an inherited GIT_DIR point the fixture at another repository", () => {
    const other = join(workspace, "other");
    mkdirSync(other, { recursive: true });
    expect(tryHermeticGit(["init", "--initial-branch", "main"], other).status).toBe(0);
    const redirect = { GIT_DIR: join(other, ".git") };

    // Control: a plain invocation run INSIDE `repo` resolves to `other`. A test
    // that staged a credential fixture under this env would be operating on
    // whatever repository the parent process was pointing at.
    const hijacked = plainGit(["rev-parse", "--absolute-git-dir"], repo, redirect);
    expect(hijacked.status).toBe(0);
    expect(hijacked.stdout.trim()).toContain(join("other", ".git"));

    const previousEnv = process.env;
    try {
      process.env = { ...previousEnv, ...redirect };
      const hermetic = tryHermeticGit(["rev-parse", "--absolute-git-dir"], repo);
      expect(hermetic.status).toBe(0);
      expect(hermetic.stdout.trim()).not.toContain(join("other", ".git"));
      expect(hermetic.stdout.trim()).toContain(join("repo", ".git"));
    } finally {
      process.env = previousEnv;
    }
  });

  it("scopes hermeticity to one invocation and disarms nothing else", () => {
    stage("scoped.txt");

    // A hermetic commit first...
    expect(tryHermeticGit(["commit", "-m", "hermetic"], repo).status).toBe(0);

    // ...then the ambient hook must STILL refuse an ordinary commit in the same
    // repository. The exemption is per-invocation; it does not persist into the
    // repo, the config, or the process.
    stage("scoped-again.txt");
    const stillBlocked = plainGit(["commit", "-m", "plain"], repo, ambientViaConfigFile());
    expect(stillBlocked.status).not.toBe(0);
    expect(stillBlocked.stderr).toContain(HOOK_MARKER);
  });

  it("does not mutate the caller's own environment", () => {
    const before = { ...process.env };
    hermeticGitEnv();
    expect({ ...process.env }).toEqual(before);
  });

  it("commits a synthetic credential fixture under this machine's real ambient config", () => {
    // The defect exactly as reported: on a fleet machine the global
    // core.hooksPath refuses this commit and the scanner's history tests die.
    // Assembled from fragments so the literal never appears contiguously in
    // source — this file has to survive the very scan it is about.
    const synthetic = ["sk", "proj", "livevalueabcdefghijklmnopqrstuvwxyz"].join("-");
    writeFileSync(join(repo, "fixture.env"), `OPENAI_API_KEY=${synthetic}\n`);

    expect(tryHermeticGit(["add", "fixture.env"], repo).status).toBe(0);
    const committed = tryHermeticGit(["commit", "-m", "fixture credential"], repo);

    expect(committed.stderr).not.toContain("BLOCKED");
    expect(committed.status).toBe(0);
  });
});
