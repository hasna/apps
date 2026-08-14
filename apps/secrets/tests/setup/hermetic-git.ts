// Hermetic fixture git: the one way this suite is allowed to invoke git.
//
// Same shape as tests/setup/isolate-vault.ts, one layer down: the ambient
// environment on a Hasna fleet machine steers a child process somewhere the
// test author never intended, and the failure is silent in the direction that
// loses.
//
// WHAT IT IS FOR. The scanner's history tests must commit a synthetic
// credential into a throwaway repo in tmpdir — that IS the capability under
// test. The fleet-global core.hooksPath installs a staged-secrets pre-commit
// scan, which (correctly, for real repos) refuses that commit, so the fixture
// died on every fleet machine with "BLOCKED: credential pattern found in
// staged changes". Nothing was leaked and no PR was at fault, but the wreckage
// is shaped exactly like a credential leak in whatever change was under review.
//
// WHAT IT DOES NOT DO. It does not weaken, narrow, or bypass that hook for any
// real repository. The hook's own design contract names a repo-local /
// per-invocation core.hooksPath as an accepted property of client-side hooks
// ("a guardrail against ACCIDENT"), and this scope is one throwaway directory
// created by mkdir and deleted in afterEach. Real commits in real repos are
// untouched — which is asserted, not asserted-by-comment, in
// tests/hermetic-git.test.ts.

import { spawnSync } from "node:child_process";

/**
 * Environment variables that let the ambient process REDIRECT git at a
 * different repository. GIT_DIR was measured live (git 2.43.0): with GIT_DIR
 * set, `git rev-parse --absolute-git-dir` run inside the fixture directory
 * resolves to the OTHER repo — so `git commit` in a fixture would operate on
 * whatever repository the parent was pointing at. The rest are the same
 * mechanism through a different name and are closed by the same rule rather
 * than left as an arbitrary gap.
 */
const REPO_LOCATION_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
];

/**
 * Environment channels that INJECT config keys, including core.hooksPath, on
 * top of every config file. Both were measured live on git 2.43.0: each one
 * re-armed the ambient hook even with GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM
 * pointed at /dev/null. Pinning only the config FILES is therefore not
 * hermetic, which is the gap this module exists to close.
 *
 * GIT_CONFIG was measured NOT to inject on 2.43.0 and is deliberately absent —
 * listing it would claim coverage of a channel that was never open.
 */
const CONFIG_INJECTION_KEYS = ["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"];

/**
 * Build a git environment that answers only to its arguments and its cwd.
 *
 * Two halves, and both are load-bearing:
 *   - the config FILES are pinned to /dev/null, which is what neutralises a
 *     global core.hooksPath;
 *   - the env channels above are DELETED, which is what stops the same setting
 *     arriving by another route.
 */
export function hermeticGitEnv(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };

  for (const key of REPO_LOCATION_KEYS) delete env[key];
  for (const key of CONFIG_INJECTION_KEYS) delete env[key];

  // GIT_CONFIG_COUNT is the header for an indexed list. Drop the whole list,
  // not just the count, so a stale GIT_CONFIG_KEY_0 cannot be re-counted by a
  // later git that reads the pairs some other way.
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }

  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  return env;
}

/** Result of a fixture git invocation. Never throws — the caller decides. */
export interface HermeticGitResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run git hermetically in `cwd`, returning the raw result. */
export function tryHermeticGit(args: string[], cwd: string): HermeticGitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: hermeticGitEnv(),
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Run git hermetically in `cwd`, throwing on any non-zero exit. */
export function hermeticGit(args: string[], cwd: string): void {
  const result = tryHermeticGit(args, cwd);
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `git ${args.join(" ")} failed`,
    );
  }
}
