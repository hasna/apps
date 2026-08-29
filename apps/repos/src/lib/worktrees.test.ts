import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import {
  WorktreeError,
  addWorktree,
  adoptWorktrees,
  assertWorktreeName,
  clonesRootDir,
  computeClonePath,
  computeWorktreePath,
  listWorktrees,
  releaseWorktree,
  removeWorktree,
  setClonesRootForTests,
  setWorktreeRootForTests,
  worktreeRootDir,
} from "./worktrees.js";

let tempDir = "";

afterEach(() => {
  closeDb();
  setWorktreeRootForTests(null);
  setClonesRootForTests(null);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

/**
 * Git invoked with the developer's own configuration neutralised.
 *
 * The fixtures have to behave identically on a station whose global gitconfig
 * sets `init.defaultBranch`, a commit template, hooks or a credential helper.
 * A test that quietly inherits those is testing the station, not the code.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "Repos Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Repos Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
}

function commit(repoPath: string, file: string, body: string): string {
  writeFileSync(join(repoPath, file), body);
  git(repoPath, ["add", file]);
  git(repoPath, ["commit", "-m", `add ${file}`]);
  return git(repoPath, ["rev-parse", "HEAD"]);
}

/**
 * An origin plus a clone of it, a registry row for the clone, and a worktree
 * root — the minimum shape every verb operates on.
 */
function seed(opts: {
  repoName?: string;
  withOrigin?: boolean;
  cloneRelativePath?: string;
  indexedRemote?: string;
} = {}) {
  const repoName = opts.repoName ?? "open-fixture";
  tempDir = mkdtempSync(join(tmpdir(), "repos-worktree-"));
  const root = join(tempDir, "worktrees");
  mkdirSync(root, { recursive: true });
  setWorktreeRootForTests(root);

  const originPath = join(tempDir, "origin.git");
  const seedPath = join(tempDir, "seed");
  mkdirSync(seedPath, { recursive: true });
  git(tempDir, ["init", "--bare", "--initial-branch=main", originPath]);
  git(seedPath, ["init", "--initial-branch=main"]);
  const firstSha = commit(seedPath, "README.md", "seed\n");
  git(seedPath, ["remote", "add", "origin", originPath]);
  git(seedPath, ["push", "-u", "origin", "main"]);

  const clonePath = join(tempDir, opts.cloneRelativePath ?? "clone");
  mkdirSync(dirname(clonePath), { recursive: true });
  if (opts.withOrigin === false) {
    git(tempDir, ["clone", originPath, clonePath]);
    git(clonePath, ["remote", "remove", "origin"]);
  } else {
    git(tempDir, ["clone", originPath, clonePath]);
  }

  const dbPath = join(tempDir, "repos.db");
  const db = getDb(dbPath);
  const inserted = db.prepare(
    "INSERT INTO repos (path, name, org, remote_url, default_branch, updated_at) VALUES (?, ?, 'hasna', ?, 'main', ?)",
  ).run(clonePath, repoName, opts.indexedRemote ?? `github.com/hasna/${repoName}`, "2026-07-01 00:00:00");

  return {
    root,
    originPath,
    seedPath,
    clonePath,
    dbPath,
    db,
    repoName,
    repoId: Number(inserted.lastInsertRowid),
    firstSha,
  };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof WorktreeError) return error.code;
    return `UNEXPECTED:${(error as Error).message}`;
  }
  return "NO_ERROR";
}

describe("worktree name and path computation", () => {
  test("a name is a single path segment, so no name can address another directory", () => {
    // The whole containment argument rests on this. If a name may contain a
    // separator or a dot-dot component then `<root>/<repo>/<name>` is not a
    // path under the root, it is a path expression the caller controls.
    for (const bad of [
      "..",
      ".",
      "",
      "a/b",
      "../escape",
      "a\\b",
      "-leading-dash",
      "with space",
      "trailing.",
      "nul\0byte",
      "x".repeat(129),
      "sub/../../etc",
    ]) {
      expect(codeOf(() => assertWorktreeName(bad))).toBe("INVALID_WORKTREE_NAME");
    }
    for (const good of ["a321ba13", "a321ba13-worktree-verbs", "pr36_fix", "OPE57.00011"]) {
      expect(assertWorktreeName(good)).toBe(good);
    }
  });

  test("the path is computed from the root, never supplied", () => {
    tempDir = mkdtempSync(join(tmpdir(), "repos-worktree-path-"));
    setWorktreeRootForTests(join(tempDir, "worktrees"));
    expect(computeWorktreePath("repos", "a321ba13")).toBe(
      join(tempDir, "worktrees", "repos", "a321ba13"),
    );
  });

  test("the root is derived from the account database, not from $HOME", () => {
    // $HOME is process environment state any caller can set. If the root moved
    // with it, every containment check in this module would be bypassable by
    // one exported variable — the cheapest possible escape.
    //
    // The answer is compared before and after rather than against a literal,
    // because on a container whose uid has no passwd entry the correct answer is
    // TRUSTED_HOME_UNAVAILABLE — and "it refuses identically with a forged HOME"
    // is the same property as "it answers identically with a forged HOME".
    const read = () => {
      try {
        return `path:${worktreeRootDir()}`;
      } catch (error) {
        return `error:${(error as WorktreeError).code}`;
      }
    };
    const before = read();
    expect(before === "error:TRUSTED_HOME_UNAVAILABLE" || before.startsWith("path:/")).toBe(true);

    const original = process.env["HOME"];
    process.env["HOME"] = "/tmp/not-the-real-home";
    try {
      expect(read()).toBe(before);
    } finally {
      if (original === undefined) delete process.env["HOME"];
      else process.env["HOME"] = original;
    }
  });
});

describe("computeClonePath", () => {
  test("the clone path is org-scoped under the root — never flat", () => {
    tempDir = mkdtempSync(join(tmpdir(), "repos-clone-path-"));
    const root = join(tempDir, "clones");
    setClonesRootForTests(root);
    expect(computeClonePath("hasna", "apps")).toBe(join(root, "hasna", "apps"));
    // The regression this exists for: two orgs both owning an `apps` repo must
    // not collide flat at the root.
    expect(computeClonePath("hasna", "apps")).not.toBe(join(root, "apps"));
    expect(computeClonePath("hasnaxyz", "apps")).toBe(join(root, "hasnaxyz", "apps"));
  });

  test("the clones root is derived from the account database, not from $HOME", () => {
    // Same discipline as `worktreeRootDir` and for the same reason: a root
    // that moved with `$HOME` would be a containment check any caller can step
    // around by exporting one value before invoking the CLI.
    const read = () => {
      try {
        return `path:${clonesRootDir()}`;
      } catch (error) {
        return `error:${(error as WorktreeError).code}`;
      }
    };
    const before = read();
    expect(before === "error:TRUSTED_HOME_UNAVAILABLE" || before.startsWith("path:/")).toBe(true);

    const original = process.env["HOME"];
    process.env["HOME"] = "/tmp/not-the-real-home";
    try {
      expect(read()).toBe(before);
    } finally {
      if (original === undefined) delete process.env["HOME"];
      else process.env["HOME"] = original;
    }
  });
});

describe("the root follows the resolver data root (P5.1)", () => {
  const RESOLVER_ENV_KEYS = ["HASNA_REPOS_HOME", "HASNA_DATA_HOME"] as const;

  afterEach(() => {
    setWorktreeRootForTests(null);
    setClonesRootForTests(null);
  });

  function runWithEnv(overrides: Record<string, string>, fn: () => void): void {
    const saved: Partial<Record<string, string | undefined>> = {};
    for (const key of Object.keys(overrides)) saved[key] = process.env[key];
    try {
      for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
      fn();
    } finally {
      for (const key of Object.keys(overrides)) {
        const value = saved[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  test("HASNA_REPOS_HOME redirects the worktree root and the clones root", () => {
    const exact = join(tmpdir(), "repos-exact-override");
    runWithEnv({ HASNA_REPOS_HOME: exact }, () => {
      expect(worktreeRootDir()).toBe(join(exact, "worktrees"));
      expect(clonesRootDir()).toBe(join(exact, "clones"));
      expect(computeWorktreePath("repos", "a321ba13")).toBe(join(exact, "worktrees", "repos", "a321ba13"));
      expect(computeClonePath("hasna", "apps")).toBe(join(exact, "clones", "hasna", "apps"));
    });
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root for the worktree root", () => {
    const xdg = join(tmpdir(), "repos-xdg-data-home");
    runWithEnv({ HASNA_DATA_HOME: xdg }, () => {
      expect(worktreeRootDir()).toBe(join(xdg, "repos", "worktrees"));
      expect(clonesRootDir()).toBe(join(xdg, "repos", "clones"));
    });
  });
});

describe("addWorktree", () => {
  test("resolves an exact numeric registry ID to the same repository as its exact path", () => {
    const { clonePath, repoId } = seed();
    const byPath = addWorktree({ repo: clonePath, task: "by-path" });
    const byNumericId = addWorktree({ repo: String(repoId), task: "by-numeric-id" });

    expect(byNumericId.lease.repo_catalog_id).toBe(byPath.lease.repo_catalog_id);
    expect(byNumericId.lease.repo_path).toBe(byPath.lease.repo_path);
    expect(byNumericId.lease.repo_id).toBe(byPath.lease.repo_id);
  });

  test("refuses a mismatched managed checkout before creating a branch, directory, or lease", () => {
    const { root, clonePath, db } = seed({
      repoName: "iapp-fixture",
      cloneRelativePath: join("workspace", "hasnaxyz", "internalapp", "iapp-fixture"),
      indexedRemote: "github.com/hasna/fixture",
    });

    expect(codeOf(() => addWorktree({ repo: clonePath, name: "identity-mismatch" })))
      .toBe("REPO_IDENTITY_MISMATCH");
    expect(readdirSync(root)).toEqual([]);
    expect(git(clonePath, ["branch", "--list", "identity-mismatch"])).toBe("");
    expect((db.query("SELECT COUNT(*) AS count FROM worktree_leases").get() as { count: number }).count).toBe(0);
  });

  test("places the worktree at the computed canonical path and records a lease", () => {
    const { root, clonePath, repoName } = seed();
    const result = addWorktree({ repo: repoName, task: "a321ba13" });

    expect(result.path).toBe(join(root, repoName, "a321ba13"));
    expect(existsSync(join(result.path, "README.md"))).toBe(true);
    expect(result.lease.status).toBe("claimed");
    expect(result.lease.task_id).toBe("a321ba13");
    expect(result.lease.worktree_path).toBe(result.path);
    expect(result.created).toBe(true);

    const listed = git(clonePath, ["worktree", "list", "--porcelain"]);
    expect(listed).toContain(realpathSync(result.path));
  });

  test("refuses a crafted name that would escape the root, and writes nothing", () => {
    // The adversarial-review finding this pins: without single-segment
    // validation, `--name ../../etc` resolves outside the root before any
    // containment check downstream ever runs.
    const { root, repoName } = seed();
    expect(codeOf(() => addWorktree({ repo: repoName, name: "../../escape" })))
      .toBe("INVALID_WORKTREE_NAME");
    expect(codeOf(() => addWorktree({ repo: repoName, task: "../escape" })))
      .toBe("INVALID_WORKTREE_NAME");
    expect(readdirSync(root)).toEqual([]);
  });

  test("refuses a broken parent checkout instead of wedging on it", () => {
    // The live instance: registry row 92's `.git` holds only `hooks/` and
    // `worktrees/`, and the structural checkout classifier rejects it. Every
    // verb that assumes a healthy parent turns that into a confusing git error.
    const { clonePath, repoName } = seed();
    rmSync(join(clonePath, ".git"), { recursive: true, force: true });
    mkdirSync(join(clonePath, ".git", "hooks"), { recursive: true });
    mkdirSync(join(clonePath, ".git", "worktrees"), { recursive: true });

    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13" })))
      .toBe("PARENT_CHECKOUT_BROKEN");
  });

  test("uses the structural checkout verdict for a populated bare parent", () => {
    // `classifyCheckout` deliberately accepts a populated bare repository.
    // The former `rev-parse --is-inside-work-tree` judgement rejected it even
    // though `git worktree add` supports it, which let the two owners drift.
    const { root, originPath, repoName, db } = seed();
    db.prepare("UPDATE repos SET path = ? WHERE name = ?").run(originPath, repoName);

    const result = addWorktree({ repo: repoName, task: "a321ba13" });

    expect(result.path).toBe(join(root, repoName, "a321ba13"));
    expect(result.lease.git_common_dir).toBe(realpathSync(originPath));
    expect(existsSync(join(result.path, "README.md"))).toBe(true);
  });

  test("refuses an occupied path and leaves its contents untouched", () => {
    // THE REGRESSION THIS PINS. iapp-factory's addWorktree began by force-removing
    // whatever sat at the target path — `git worktree remove --force`, `prune`,
    // then `rmSync(recursive, force)`. A destructive teardown is not a
    // precondition for a create, and this asserts the file survives.
    const { root, repoName } = seed();
    const occupied = join(root, repoName, "a321ba13");
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, "PRECIOUS.txt"), "not yours to delete\n");

    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13" })))
      .toBe("WORKTREE_PATH_OCCUPIED");
    expect(readFileSync(join(occupied, "PRECIOUS.txt"), "utf8")).toBe("not yours to delete\n");
  });

  test("re-adding the same task returns the existing lease rather than recreating it", () => {
    const { repoName } = seed();
    const first = addWorktree({ repo: repoName, task: "a321ba13" });
    writeFileSync(join(first.path, "WORK-IN-PROGRESS.txt"), "half-finished\n");

    const second = addWorktree({ repo: repoName, task: "a321ba13" });
    expect(second.lease.lease_id).toBe(first.lease.lease_id);
    expect(second.created).toBe(false);
    expect(second.reused).toBe(true);
    expect(readFileSync(join(first.path, "WORK-IN-PROGRESS.txt"), "utf8")).toBe("half-finished\n");
  });

  test("refuses to reuse a worktree claimed on a different base", () => {
    // THE REGRESSION THIS PINS. `existing` is resolved as
    // `leaseByClaim(...) ?? leaseByPath(db, target)` — leaseByClaim's WHERE
    // includes base_ref, so a changed `--base` misses the claim lookup, but the
    // leaseByPath fallback matches on the same computed path. The reuse branch
    // then returned `created:false, reused:true` with the OLD lease's
    // base_ref/base_sha at exit 0, never comparing the caller's base against
    // the lease's — a silent success on the wrong base, the exact stale-base
    // hazard resolveBase exists to prevent.
    const { seedPath, repoName, db } = seed();
    const releaseSha = commit(seedPath, "RELEASE.md", "release line\n");
    git(seedPath, ["branch", "release-1.0"]);
    git(seedPath, ["push", "origin", "release-1.0"]);

    const first = addWorktree({ repo: repoName, task: "a321ba13" });
    expect(first.lease.base_ref).toBe("main");
    writeFileSync(join(first.path, "WORK-IN-PROGRESS.txt"), "half-finished\n");

    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13", base: "origin/release-1.0" })))
      .toBe("WORKTREE_BASE_MISMATCH");

    // The lease and the worktree are untouched: same lease id, same base, file
    // still in place.
    const lease = db.query("SELECT * FROM worktree_leases WHERE lease_id = ?")
      .get(first.lease.lease_id) as { base_ref: string; base_sha: string };
    expect(lease.base_ref).toBe("main");
    expect(lease.base_sha).toBe(first.lease.base_sha);
    expect(releaseSha).not.toBe(first.lease.base_sha);
    expect(existsSync(first.path)).toBe(true);
    expect(readdirSync(first.path)).toContain("WORK-IN-PROGRESS.txt");
  });

  test("refuses to reuse a worktree whose claimed branch differs from the requested branch", () => {
    const { repoName, db } = seed();
    const first = addWorktree({ repo: repoName, task: "a321ba13", branch: "task-a321ba13" });
    const verifiedAt = (db.query("SELECT verified_at FROM worktree_leases WHERE lease_id = ?")
      .get(first.lease.lease_id) as { verified_at: string }).verified_at;

    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13", branch: "other-branch" })))
      .toBe("WORKTREE_BASE_MISMATCH");

    // Same lease id, branch and verified_at unchanged: the mismatch refused the
    // reuse before any lease state could be refreshed.
    const lease = db.query("SELECT branch, verified_at FROM worktree_leases WHERE lease_id = ?")
      .get(first.lease.lease_id) as { branch: string; verified_at: string };
    expect(lease.branch).toBe("task-a321ba13");
    expect(lease.verified_at).toBe(verifiedAt);
    expect(existsSync(first.path)).toBe(true);
  });

  test("refuses same-claim re-entry once the lease's gitdir is dead, without refreshing verified_at", () => {
    // The dead-gitdir class in the reuse path: the lease exists, the directory
    // exists, and the `.git` pointer is shape-valid — but the target gitdir is
    // gone, exactly as a parent-checkout move leaves it. The reuse guard must
    // not hand back a worktree git cannot open, and must not mark the lease
    // verified.
    const { repoName, db } = seed();
    const first = addWorktree({ repo: repoName, task: "a321ba13" });
    const claimedAt = (db.query("SELECT verified_at FROM worktree_leases WHERE lease_id = ?")
      .get(first.lease.lease_id) as { verified_at: string }).verified_at;

    // Kill the gitdir the worktree's `.git` pointer names, the way a moved
    // parent checkout does. Deleting the object store directory instead would
    // still be a live gitdir; the linked-worktree metadata must go.
    const pointer = readFileSync(join(first.path, ".git"), "utf8").trim();
    const gitdirTarget = pointer.replace(/^gitdir:\s*/, "");
    rmSync(gitdirTarget, { recursive: true, force: true });

    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13" })))
      .toBe("WORKTREE_DEAD_GITDIR");
    const after = (db.query("SELECT verified_at FROM worktree_leases WHERE lease_id = ?")
      .get(first.lease.lease_id) as { verified_at: string }).verified_at;
    expect(after).toBe(claimedAt);
    expect(existsSync(first.path)).toBe(true);
  });

  test("pins the base from origin, not from a stale local HEAD", () => {
    // A worktree branched off a local HEAD that is three days behind origin
    // produces a PR full of other people's reverts. The fetch is the point.
    const { seedPath, clonePath, repoName } = seed();
    const advanced = commit(seedPath, "SECOND.md", "advanced\n");
    git(seedPath, ["push", "origin", "main"]);
    const staleLocal = git(clonePath, ["rev-parse", "HEAD"]);
    expect(staleLocal).not.toBe(advanced);

    const result = addWorktree({ repo: repoName, task: "a321ba13" });
    expect(result.base.sha).toBe(advanced);
    expect(result.base.source).toBe("origin");
    expect(result.lease.base_sha).toBe(advanced);
  });

  test("resolves remote-qualified base refs to the same origin sha", () => {
    // `git fetch origin -- origin/main` fails because `origin/main` is a LOCAL
    // remote-tracking name, not a ref the remote holds — the literal refspec
    // after `--` matches nothing on the remote. So `--base origin/main` and
    // `--base refs/remotes/origin/main` must be rewritten to the underlying
    // branch name before the fetch, and must pin the same sha as `--base
    // refs/heads/main`.
    const { seedPath, repoName } = seed();
    const advanced = commit(seedPath, "SECOND.md", "advanced\n");
    git(seedPath, ["push", "origin", "main"]);

    const byHeads = addWorktree({ repo: repoName, task: "base-heads", base: "refs/heads/main" });
    const byShorthand = addWorktree({ repo: repoName, task: "base-shorthand", base: "origin/main" });
    const byRemoteRef = addWorktree({ repo: repoName, task: "base-remote-ref", base: "refs/remotes/origin/main" });

    expect(byHeads.base.sha).toBe(advanced);
    expect(byShorthand.base.sha).toBe(advanced);
    expect(byShorthand.base.source).toBe("origin");
    expect(byShorthand.base.ref).toBe("origin/main");
    expect(byRemoteRef.base.sha).toBe(advanced);
    expect(byRemoteRef.base.source).toBe("origin");
    expect(byRemoteRef.base.ref).toBe("refs/remotes/origin/main");
    for (const result of [byHeads, byShorthand, byRemoteRef]) {
      expect(result.lease.base_sha).toBe(advanced);
    }
  });

  test("rejects a base ref that exists nowhere with BASE_REF_UNRESOLVABLE", () => {
    const { repoName } = seed();
    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13", base: "no-such-branch" })))
      .toBe("BASE_REF_UNRESOLVABLE");
  });

  test("fails closed when the base cannot be fetched from origin", () => {
    // Silently branching off whatever is local is the degradation this refuses.
    const { clonePath, repoName } = seed();
    git(clonePath, ["remote", "set-url", "origin", join(tempDir, "no-such-origin.git")]);
    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13" })))
      .toBe("BASE_REF_UNRESOLVABLE");
  });

  test("resolves the base locally, and says so, when the repo has no remote", () => {
    // Not a fallback: a repo with no origin has no upstream that could be
    // fresher. The distinction is recorded rather than hidden.
    const { repoName } = seed({ withOrigin: false });
    const result = addWorktree({ repo: repoName, task: "a321ba13" });
    expect(result.base.source).toBe("local");
  });

  test("a ref argument cannot smuggle a git option, and the payload is live", () => {
    // `git fetch origin <ref>` parses options anywhere on the line, so a ref
    // beginning with `-` is not a ref — it is an argument to git. `--upload-pack`
    // names a command to run. This is the one input on `add` that is neither a
    // slug nor computed, so it is the one that has to be argued about.
    const { clonePath, repoName } = seed();
    const marker = join(tempDir, "pwned-marker");
    const payload = `--upload-pack=touch ${marker}; git-upload-pack`;

    expect(codeOf(() => addWorktree({ repo: repoName, task: "inject-base", base: payload })))
      .toBe("INVALID_BASE_REF");
    expect(existsSync(marker)).toBe(false);

    expect(codeOf(() => addWorktree({ repo: repoName, task: "inject-branch", branch: "-D" })))
      .toBe("INVALID_BRANCH_NAME");

    // POSITIVE CONTROL. Without this the assertion above proves only that some
    // string was rejected. Handed to git the way an unvalidated ref would be,
    // the same payload executes and creates the marker — so the check above had
    // something real to stop.
    expect(existsSync(marker)).toBe(false);
    try {
      git(clonePath, ["fetch", "--quiet", "origin", payload]);
    } catch {
      // git may still exit non-zero after running the payload; the marker is
      // the observation that matters.
    }
    expect(existsSync(marker)).toBe(true);
  });

  test("the reuse path reports how the base was actually resolved", () => {
    // Adversarial-review finding P2-4: `source` was hardcoded to "origin" on
    // re-entry, so the field that exists to evidence the fail-closed fetch
    // fabricated itself on the second call.
    const { repoName } = seed({ withOrigin: false });
    const first = addWorktree({ repo: repoName, task: "base-source" });
    expect(first.base.source).toBe("local");
    const second = addWorktree({ repo: repoName, task: "base-source" });
    expect(second.reused).toBe(true);
    expect(second.base.source).toBe("local");
  });

  test("corrupt lease metadata does not invent an origin on reuse", () => {
    const { db, repoName } = seed({ withOrigin: false });
    const first = addWorktree({ repo: repoName, task: "corrupt-base-source" });
    expect(first.base.source).toBe("local");

    db.prepare("UPDATE worktree_leases SET owner_metadata = ? WHERE lease_id = ?")
      .run("{not-json", first.lease.lease_id);

    const second = addWorktree({ repo: repoName, task: "corrupt-base-source" });
    expect(second.reused).toBe(true);
    expect(second.base.source).toBe("local");
  });

  test("requires exactly one of --task and --name", () => {
    const { repoName } = seed();
    expect(codeOf(() => addWorktree({ repo: repoName }))).toBe("INVALID_REQUEST");
    expect(codeOf(() => addWorktree({ repo: repoName, task: "a", name: "b" }))).toBe("INVALID_REQUEST");
  });

  test("reports an unknown repo rather than inventing a path for it", () => {
    const {} = seed();
    expect(codeOf(() => addWorktree({ repo: "open-not-registered", task: "a321ba13" })))
      .toBe("REPO_NOT_FOUND");
  });

  test("keeps the measured ambiguity hard-fail", () => {
    const { db, repoName } = seed();
    db.prepare(
      "INSERT INTO repos (path, name, org, remote_url, default_branch, updated_at) VALUES (?, ?, 'hasna', ?, 'main', ?)",
    ).run(join(tempDir, "second-clone"), repoName, `github.com/hasna/${repoName}`, "2026-07-01 00:00:00");
    expect(codeOf(() => addWorktree({ repo: repoName, task: "a321ba13" }))).toBe("AMBIGUOUS_REPO");
  });
});

describe("removeWorktree", () => {
  test("cannot be handed a filesystem path at all", () => {
    // The factory hazard becomes unrepresentable rather than guarded: there is
    // no argument shape in which a victim path can be passed.
    const { root, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "a321ba13" });
    for (const ref of [
      created.path,
      "/etc",
      "../../etc",
      "~/.hasna",
      join(root, repoName, "a321ba13"),
      "repo/name/extra",
      "./a321ba13",
    ]) {
      expect(codeOf(() => removeWorktree({ ref }))).toBe("INVALID_REQUEST");
    }
    expect(existsSync(created.path)).toBe(true);
  });

  test("removes by lease id and by repo/name", () => {
    const { repoName } = seed();
    const byLease = addWorktree({ repo: repoName, task: "lease-ref" });
    expect(removeWorktree({ ref: byLease.lease.lease_id }).removed).toBe(true);
    expect(existsSync(byLease.path)).toBe(false);

    const byPair = addWorktree({ repo: repoName, task: "pair-ref" });
    expect(removeWorktree({ ref: `${repoName}/pair-ref` }).removed).toBe(true);
    expect(existsSync(byPair.path)).toBe(false);
  });

  test("refuses a dirty worktree unless changes are explicitly discarded", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "dirty" });
    writeFileSync(join(created.path, "README.md"), "uncommitted edit\n");

    expect(codeOf(() => removeWorktree({ ref: created.lease.lease_id }))).toBe("WORKTREE_DIRTY");
    expect(existsSync(created.path)).toBe(true);

    const forced = removeWorktree({ ref: created.lease.lease_id, discardChanges: true });
    expect(forced.removed).toBe(true);
    expect(existsSync(created.path)).toBe(false);
    expect(forced.evidence_path).toBeTruthy();
    expect(readFileSync(join(forced.evidence_path!, "dirty-status.txt"), "utf8")).toContain("README.md");
    expect(readFileSync(join(forced.evidence_path!, "tracked-changes.patch"), "utf8"))
      .toContain("uncommitted edit");
  });

  test("refuses a worktree carrying commits that exist nowhere else", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "unpushed" });
    commit(created.path, "NEW-WORK.md", "only here\n");

    expect(codeOf(() => removeWorktree({ ref: created.lease.lease_id }))).toBe("WORKTREE_UNPUSHED");

    const forced = removeWorktree({ ref: created.lease.lease_id, discardChanges: true });
    expect(existsSync(join(forced.evidence_path!, "branch.bundle"))).toBe(true);
  });

  test("the archive bundles what is actually about to be destroyed, not what the lease says", () => {
    // Adversarial-review finding P1-1. The bundle was built from the lease's
    // branch. A detached HEAD — rebase, bisect, an explicit `checkout --detach`,
    // all ordinary — puts the commits somewhere that branch does not point, so
    // `remove --discard-changes` counted them as unpushed, bundled the wrong
    // ref, destroyed the worktree, and reported an evidence path as though the
    // archive were complete. The commits existed on no ref afterwards.
    const { clonePath, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "detached" });
    git(created.path, ["checkout", "--detach", "--quiet", "HEAD"]);
    const lost = commit(created.path, "ONLY-ON-DETACHED-HEAD.md", "the commit that must survive\n");

    const forced = removeWorktree({ ref: created.lease.lease_id, discardChanges: true });
    expect(forced.removed).toBe(true);

    const bundlePath = join(forced.evidence_path!, "branch.bundle");
    expect(existsSync(bundlePath)).toBe(true);
    // Contents, not existence: a bundle of the wrong ref satisfies existsSync.
    const heads = git(clonePath, ["bundle", "list-heads", bundlePath]);
    expect(heads).toContain(lost);
    // And the archive checked itself: no INCOMPLETE marker means the bundle was
    // verified to contain HEAD, not merely written.
    expect(existsSync(join(forced.evidence_path!, "INCOMPLETE.txt"))).toBe(false);
  });

  test("deletes the branch this worktree has checked out, not the one the lease claims", () => {
    // Adversarial-review finding P2-3. The lease's branch is a stored value. It
    // goes stale the moment anyone switches branches inside the worktree, and
    // `adopt --all --apply` freezes an adopt-time name into every lease. Deleting
    // by that name reached into the parent checkout — often a shared clone — and
    // force-deleted an unrelated live branch, silently, because the delete runs
    // with allowFailure.
    const { clonePath, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "stale-lease-branch" });
    git(clonePath, ["branch", "keep-me-please"]);
    git(created.path, ["checkout", "-b", "actually-checked-out", "--quiet"]);
    getDb().prepare("UPDATE worktree_leases SET branch = 'keep-me-please' WHERE lease_id = ?")
      .run(created.lease.lease_id);

    const result = removeWorktree({ ref: created.lease.lease_id, discardChanges: true });
    expect(result.branch).toBe("actually-checked-out");

    const branches = git(clonePath, ["branch", "--format=%(refname:short)"]).split("\n");
    expect(branches).toContain("keep-me-please");
    expect(branches).not.toContain("actually-checked-out");
  });

  test("refuses when the lease path has been replaced by a symlink out of the root", () => {
    // Containment is checked after symlink resolution, because a directory that
    // was inside the root when the lease was written may not be now.
    const { root, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "symlinked" });
    const outside = join(tempDir, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "KEEP.txt"), "not in the root\n");
    rmSync(created.path, { recursive: true, force: true });
    symlinkSync(outside, created.path);

    expect(codeOf(() => removeWorktree({ ref: created.lease.lease_id, discardChanges: true })))
      .toBe("PATH_OUTSIDE_ROOT");
    expect(readFileSync(join(outside, "KEEP.txt"), "utf8")).toBe("not in the root\n");
    expect(root).toBeTruthy();
  });

  test("a lease id from the database cannot steer the evidence archive out of the root", () => {
    // The evidence directory is named after the lease id, and on the
    // `<repo>/<worktree>` path that id comes from the row rather than from the
    // argument — so it has never been through the reference parser. A row with
    // `../..` in its primary key would place the archive outside the root.
    const { root, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "poisoned-lease" });
    writeFileSync(join(created.path, "README.md"), "uncommitted\n");
    getDb().prepare("UPDATE worktree_leases SET lease_id = ? WHERE lease_id = ?")
      .run("../../../escaped", created.lease.lease_id);

    const forced = removeWorktree({ ref: `${repoName}/poisoned-lease`, discardChanges: true });
    expect(forced.removed).toBe(true);
    expect(forced.evidence_path!.startsWith(join(root, ".evidence"))).toBe(true);
    expect(existsSync(join(tempDir, "escaped"))).toBe(false);
  });

  test("removes an adopted stray that has no lease at all", () => {
    // `<repo>/<name>` has to work for the 1465 leaseless directories measured
    // under the live root, or the corpus stays unmanageable.
    const { root, clonePath, repoName } = seed();
    const stray = join(root, repoName, "hand-made");
    git(clonePath, ["worktree", "add", "-b", "hand-made", stray]);

    const result = removeWorktree({ ref: `${repoName}/hand-made` });
    expect(result.removed).toBe(true);
    expect(result.lease_id).toBeNull();
    expect(existsSync(stray)).toBe(false);
  });

  test("refuses to act on the parent checkout", () => {
    const { clonePath, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "parent" });
    // Point the lease at the parent checkout, the way a corrupted or
    // hand-edited row would.
    getDb().prepare("UPDATE worktree_leases SET worktree_path = ? WHERE lease_id = ?")
      .run(clonePath, created.lease.lease_id);

    expect(codeOf(() => removeWorktree({ ref: created.lease.lease_id, discardChanges: true })))
      .toBe("PATH_OUTSIDE_ROOT");
    expect(existsSync(join(clonePath, "README.md"))).toBe(true);
  });

  test("removes through the checkout that owns the worktree's gitdir, never a stale lease repo_path", () => {
    // I38-00638: the lease's stored repo_path pointed at a pre-rename mirror
    // checkout that still existed on disk, so `git worktree remove` ran from
    // the wrong repository — a clean worktree's tracked files were deleted
    // partway before git failed with an opaque GIT_FAILED and no archive. The
    // worktree's own `.git` pointer is ground truth for which gitdir owns it;
    // the lease's repo_path is a stored value that goes stale.
    const { originPath, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "stale-parent" });

    // A second checkout of the same origin, existing on disk: the "mirror" the
    // stale lease points at. `git worktree remove` from it cannot see the
    // worktree (it is registered under the original clone's gitdir).
    const mirror = join(tempDir, "mirror");
    git(tempDir, ["clone", originPath, mirror]);
    getDb().prepare("UPDATE worktree_leases SET repo_path = ? WHERE lease_id = ?")
      .run(mirror, created.lease.lease_id);

    const result = removeWorktree({ ref: created.lease.lease_id });
    expect(result.removed).toBe(true);
    expect(existsSync(created.path)).toBe(false);
    // The mirror checkout itself is untouched — the removal ran from the true
    // owner, and no file outside the worktree was mutated.
    expect(readFileSync(join(mirror, "README.md"), "utf8")).toBe("seed\n");
  });

  test("a git failure in the remove step surfaces the real git stderr", () => {
    // I38-00638: the failure read as a bare "GIT_FAILED: git worktree failed"
    // with no diagnosis and no archive. The redacted git stderr must travel
    // with the error.
    const { clonePath, repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "locked-remove" });
    git(clonePath, ["worktree", "lock", created.path]);

    let caught: unknown;
    try {
      removeWorktree({ ref: created.lease.lease_id });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorktreeError);
    const error = caught as WorktreeError;
    expect(error.code).toBe("GIT_FAILED");
    expect(error.details.git_stderr).toContain("locked");
    expect(error.message).toContain("locked");
    // The failed remove left the worktree and its files intact.
    expect(existsSync(created.path)).toBe(true);
    expect(readFileSync(join(created.path, "README.md"), "utf8")).toBe("seed\n");
  });

  test("refuses a worktree whose gitdir is dead, unless removal explicitly archives the working tree", () => {
    // The 2026-08-14 monorepo move: the parent checkout moved, and the
    // `.git/worktrees/<name>` metadata it carried went with it — the worktree
    // directory survives with a shape-valid `.git` pointer to a gitdir that no
    // longer exists. git cannot open the worktree (`fatal: not a git
    // repository`), so every git-derived guard — dirty, unpushed, landed — is
    // unanswerable, and the old code read all of them as "clean", classified
    // the worktree as landed-detached, and then failed at `git worktree
    // remove` with an opaque GIT_FAILED. There was no supported path that
    // disposed of the directory WITH evidence.
    const { root, repoName } = seed();
    const dead = join(root, repoName, "dead-pointer");
    mkdirSync(dead, { recursive: true });
    writeFileSync(join(dead, ".git"), "gitdir: /nonexistent/checkout/.git/worktrees/dead-pointer\n");
    writeFileSync(join(dead, "ONLY-HERE.txt"), "working-tree-only content\n");

    // The dry run reports the refusal as a value, and the direct call throws
    // the named code. Nothing is removed without the explicit opt-in.
    const dry = removeWorktree({ ref: `${repoName}/dead-pointer`, dryRun: true });
    expect(dry.would_remove).toBe(false);
    expect(dry.refusal).toBe("WORKTREE_DEAD_GITDIR");
    expect(codeOf(() => removeWorktree({ ref: `${repoName}/dead-pointer` }))).toBe("WORKTREE_DEAD_GITDIR");
    expect(existsSync(dead)).toBe(true);

    // The explicit opt-in archives the working tree before the directory goes,
    // because the working tree is the only content left to preserve. The
    // archive says plainly that git could not verify anything.
    const forced = removeWorktree({ ref: `${repoName}/dead-pointer`, allowDeadGitdir: true });
    expect(forced.removed).toBe(true);
    expect(existsSync(dead)).toBe(false);
    expect(forced.evidence_path).toBeTruthy();
    expect(readFileSync(join(forced.evidence_path!, "worktree-tree", "ONLY-HERE.txt"), "utf8"))
      .toBe("working-tree-only content\n");
    expect(readFileSync(join(forced.evidence_path!, "gitdir-pointer.txt"), "utf8"))
      .toContain("/nonexistent/checkout/.git/worktrees/dead-pointer");
    expect(readFileSync(join(forced.evidence_path!, "INCOMPLETE.txt"), "utf8")).toContain("git");

    // A relative pointer resolves against the worktree directory, exactly as
    // git resolves it — dead the same way, refused the same way.
    const deadRelative = join(root, repoName, "dead-relative");
    mkdirSync(deadRelative, { recursive: true });
    writeFileSync(join(deadRelative, ".git"), "gitdir: ../../nonexistent/.git/worktrees/dead-relative\n");
    expect(codeOf(() => removeWorktree({ ref: `${repoName}/dead-relative` }))).toBe("WORKTREE_DEAD_GITDIR");
  });

  test("the dead-gitdir opt-in is a no-op on a live worktree", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "live" });
    const forced = removeWorktree({ ref: created.lease.lease_id, allowDeadGitdir: true });
    expect(forced.removed).toBe(true);
    expect(forced.evidence_path).toBeNull();
  });
});

describe("releaseWorktree argument shape", () => {
  test("a <repo>/<worktree> pair is refused rather than silently matching no lease", () => {
    // The pair form is valid for `remove`, so handing it to `release` is a
    // plausible mistake. Looking up a lease id of "" and reporting
    // LEASE_NOT_FOUND would send the caller hunting for a missing row.
    const { repoName } = seed();
    addWorktree({ repo: repoName, task: "release-shape" });
    expect(codeOf(() => releaseWorktree({ leaseId: `${repoName}/release-shape` }))).toBe("INVALID_REQUEST");
  });

  test("a filesystem path is refused by shape", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "release-path" });
    expect(codeOf(() => releaseWorktree({ leaseId: created.path }))).toBe("INVALID_REQUEST");
    expect(existsSync(created.path)).toBe(true);
  });
});

describe("listWorktrees", () => {
  test("names a linked worktree whose gitdir pointer is dead", () => {
    const { root, repoName } = seed();
    const live = addWorktree({ repo: repoName, task: "live-one" });

    // A shape-valid `.git` pointer whose gitdir no longer exists: the parent
    // checkout moved or was deleted and took its `.git/worktrees/<name>`
    // metadata with it. git cannot open the worktree, and the reconciliation
    // surface has to be able to say so.
    const dead = join(root, repoName, "dead-pointer");
    mkdirSync(dead, { recursive: true });
    writeFileSync(join(dead, ".git"), "gitdir: /nonexistent/checkout/.git/worktrees/dead-pointer\n");

    // A relative pointer resolves against the worktree directory, exactly as
    // git resolves it.
    const deadRelative = join(root, repoName, "dead-relative");
    mkdirSync(deadRelative, { recursive: true });
    writeFileSync(join(deadRelative, ".git"), "gitdir: ../../nonexistent/.git/worktrees/dead-relative\n");

    const report = listWorktrees();
    const byPath = new Map(report.entries.map((entry) => [entry.path, entry]));

    expect(byPath.get(dead)?.is_worktree).toBe(true);
    expect(byPath.get(dead)?.issues).toContain("dead-gitdir");
    expect(byPath.get(deadRelative)?.issues).toContain("dead-gitdir");
    expect(byPath.get(live.path)?.issues).not.toContain("dead-gitdir");
    expect(report.summary.issue_count).toBeGreaterThanOrEqual(2);
  });

  test("reconciles leases against disk and names the measured corruption classes", () => {
    const { root, repoName } = seed();
    const live = addWorktree({ repo: repoName, task: "live-one" });

    // A flat task-named directory directly under the root — the largest class
    // in the 444-entry corpus measured on this station.
    const flat = join(root, "accounts-pr16-resolve");
    mkdirSync(flat, { recursive: true });
    git(tempDir, ["init", "--initial-branch=main", flat]);

    // A machine-segment directory, explicitly forbidden by the convention.
    const stationDir = join(root, "station01", "open-hooks", "wt_1");
    mkdirSync(stationDir, { recursive: true });
    git(tempDir, ["init", "--initial-branch=main", stationDir]);

    // A lease whose directory is gone.
    const orphan = addWorktree({ repo: repoName, task: "orphan-lease" });
    rmSync(orphan.path, { recursive: true, force: true });

    const report = listWorktrees();
    const byPath = new Map(report.entries.map((entry) => [entry.path, entry]));

    expect(byPath.get(live.path)?.issues).toEqual([]);
    expect(byPath.get(flat)?.issues).toContain("flat-layout");
    expect(byPath.get(flat)?.issues).toContain("no-lease");
    expect(byPath.get(stationDir)?.issues).toContain("nested-layout");
    // The repo segment is carried down, or `worktree list <repo>` filters out a
    // violation sitting literally inside that repo's directory.
    expect(byPath.get(stationDir)?.repo_name).toBe("station01");
    expect(byPath.get(orphan.path)?.issues).toContain("missing-directory");
    // A lease whose directory is gone still reports the repo segment it lived
    // under, so `worktree list <repo>` can surface it.
    expect(byPath.get(orphan.path)?.repo_name).toBe(repoName);
    expect(report.summary.issue_count).toBeGreaterThanOrEqual(3);
  });

  test("flags leases claimed by another machine and leases past the staleness horizon", () => {
    // The machine ids are stated explicitly rather than taken from the station.
    // This host's hostname is literally `station01`, so a fixture that hard-coded
    // a "foreign" machine name matched the real one and the mismatch check could
    // not have fired — the test would have passed for the wrong reason.
    const { repoName } = seed();
    const mine = addWorktree({ repo: repoName, task: "mine", machineId: "fixture-machine-a" });
    getDb().prepare("UPDATE worktree_leases SET claimed_at = '2026-07-09T00:00:00Z' WHERE lease_id = ?")
      .run(mine.lease.lease_id);

    const report = listWorktrees({
      staleDays: 1,
      now: new Date("2026-07-28T00:00:00Z"),
      machineId: "fixture-machine-b",
    });
    const entry = report.entries.find((row) => row.lease_id === mine.lease.lease_id);
    expect(entry?.issues).toContain("machine-mismatch");
    expect(entry?.issues).toContain("stale");
  });
});

describe("adoptWorktrees", () => {
  test("refuses a dead-gitdir worktree and skips it in bulk mode", () => {
    const { root, repoName } = seed();
    const dead = join(root, repoName, "dead-pointer");
    mkdirSync(dead, { recursive: true });
    writeFileSync(join(dead, ".git"), "gitdir: /nonexistent/checkout/.git/worktrees/dead-pointer\n");

    // A lease on a worktree git cannot open would claim `verified_at` for a
    // directory that can never be verified — refuse the single-path form.
    expect(codeOf(() => adoptWorktrees({ path: dead, apply: true }))).toBe("WORKTREE_DEAD_GITDIR");

    // The bulk sweep reports the dead candidate as skipped rather than
    // leasing it, so the sweep does not fail on the first dead entry and does
    // not lie about what it adopted.
    const bulk = adoptWorktrees({ all: true, apply: true });
    expect(bulk.adopted.map((row) => row.path)).not.toContain(dead);
    expect(bulk.skipped.map((row) => row.path)).toContain(dead);
    expect(bulk.skipped[0]!.reason).toBe("dead-gitdir");
  });

  test("backfills a lease for a stray worktree without touching it", () => {
    const { root, clonePath, repoName } = seed();
    const stray = join(root, repoName, "hand-made");
    git(clonePath, ["worktree", "add", "-b", "hand-made", stray]);
    writeFileSync(join(stray, "STRAY.txt"), "pre-existing work\n");

    const result = adoptWorktrees({ path: stray, apply: true });
    expect(result.adopted).toHaveLength(1);
    expect(result.adopted[0]!.mode).toBe("adopted");
    expect(readFileSync(join(stray, "STRAY.txt"), "utf8")).toBe("pre-existing work\n");
  });

  test("dry run is the default and writes no lease", () => {
    const { root, clonePath, repoName } = seed();
    const stray = join(root, repoName, "hand-made");
    git(clonePath, ["worktree", "add", "-b", "hand-made", stray]);

    const result = adoptWorktrees({ path: stray });
    expect(result.applied).toBe(false);
    expect(result.adopted).toHaveLength(1);
    expect(getDb().query("SELECT count(*) AS n FROM worktree_leases").get()).toEqual({ n: 0 });
  });

  test("refuses a path outside the root and a path that is not a worktree", () => {
    const { root, repoName } = seed();
    expect(codeOf(() => adoptWorktrees({ path: join(tempDir, "elsewhere"), apply: true })))
      .toBe("PATH_OUTSIDE_ROOT");
    const notAWorktree = join(root, repoName, "just-a-dir");
    mkdirSync(notAWorktree, { recursive: true });
    expect(codeOf(() => adoptWorktrees({ path: notAWorktree, apply: true }))).toBe("NOT_A_WORKTREE");
  });

  test("bulk mode reports every stray under the root", () => {
    const { root, clonePath, repoName } = seed();
    for (const name of ["stray-a", "stray-b"]) {
      git(clonePath, ["worktree", "add", "-b", name, join(root, repoName, name)]);
    }
    const result = adoptWorktrees({ all: true });
    expect(result.adopted.map((row) => row.worktree_name).sort()).toEqual(["stray-a", "stray-b"]);
    expect(result.applied).toBe(false);
  });

  // PLA8-00126 — `adopt --apply` no-oped on released-lease rows: the sweep saw
  // applied:true/already_leased:true and moved on, but the released row was
  // never re-claimed, so `repos worktree list` (which only counts status !=
  // 'released') kept flagging the path no-lease. 15/17 stale-sweep adopt
  // targets hit this. A released lease is not a live lease: `--apply` must
  // re-claim the same row.
  test("--apply re-claims a worktree whose lease row is released", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "adopt-released" });
    const released = releaseWorktree({ leaseId: created.lease.lease_id, keep: true });
    expect(released.lease.status).toBe("released");
    expect(existsSync(created.path)).toBe(true);

    const result = adoptWorktrees({ path: created.path, apply: true });
    expect(result.applied).toBe(true);
    expect(result.adopted).toHaveLength(1);
    expect(result.adopted[0]!.already_leased).toBe(false);

    // The path must now carry a durable claimed lease: the same row refreshed
    // (worktree_path is UNIQUE, so a second row would violate the constraint),
    // with the released state cleared.
    const rows = getDb()
      .query("SELECT lease_id, status, released_at FROM worktree_leases WHERE worktree_path = ?")
      .all(created.path) as { lease_id: string; status: string; released_at: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lease_id).toBe(created.lease.lease_id);
    expect(rows[0]!.status).toBe("claimed");
    expect(rows[0]!.released_at).toBeNull();

    // `repos worktree list` only counts non-released leases, so the re-claimed
    // row must now be visible to it.
    const listed = listWorktrees({ now: new Date() });
    expect(listed.entries.find((entry) => entry.path === created.path)?.lease_id).toBe(
      created.lease.lease_id,
    );
  });

  // PLA8-00242 — `adopt --apply` on a duplicate checkout: a second working
  // directory for the SAME checkout (same git common dir — the skills-namespace
  // copy found by the stale sweep) collides on the lease key
  // (repo_id, machine_id, task_id, run_id, base_ref). Moving the lease onto the
  // duplicate would not settle anything: the stale-sweep adopt loop would find
  // the original path no-lease on the next pass and move the lease back — a
  // flip-flop that rewrites a live claimed lease every pass and never
  // terminates. Adopt must refuse with a distinct DUPLICATE_CHECKOUT error
  // naming the leased canonical path; the sweep records the violation and
  // never adopts the duplicate, so the state terminates with the original
  // lease untouched.
  test("--apply refuses a true duplicate checkout with DUPLICATE_CHECKOUT and leaves the lease untouched", () => {
    const { root, clonePath, repoName } = seed();
    const owned = addWorktree({ repo: repoName, task: "dup-checkout" });

    // The duplicate: the same repo and the same task/dir name, but a second
    // working directory under a different namespace path (the layout violation
    // the stale sweep measured). Same clone -> same git common dir.
    const dupDir = join(root, "other-namespace", "dup-checkout");
    mkdirSync(dirname(dupDir), { recursive: true });
    git(clonePath, ["worktree", "add", "-b", "dup-copy-branch", dupDir]);

    const leaseBefore = getDb()
      .query("SELECT * FROM worktree_leases WHERE lease_id = ?")
      .get(owned.lease.lease_id) as Record<string, unknown>;

    const attempt = (): WorktreeError | null => {
      try {
        adoptWorktrees({ path: dupDir, apply: true });
        return null;
      } catch (error) {
        return error as WorktreeError;
      }
    };
    const first = attempt();
    expect(first).toBeInstanceOf(WorktreeError);
    expect((first as WorktreeError).code).toBe("DUPLICATE_CHECKOUT");
    // The error names the leased canonical path and the duplicate it refused.
    expect((first as WorktreeError).message).toContain(owned.path);
    expect((first as WorktreeError).message).toContain(dupDir);
    expect((first as WorktreeError).details.path).toBe(dupDir);
    expect((first as WorktreeError).details.lease_id).toBe(owned.lease.lease_id);

    // The live claimed lease is untouched: same row, same path, same claim
    // fields, same cleanup intent.
    const leaseAfter = getDb()
      .query("SELECT * FROM worktree_leases WHERE lease_id = ?")
      .get(owned.lease.lease_id) as Record<string, unknown>;
    expect(leaseAfter.worktree_path).toBe(owned.path);
    expect(leaseAfter.status).toBe("claimed");
    expect(leaseAfter.claimed_at).toBe(leaseBefore.claimed_at);
    expect(leaseAfter.verified_at).toBe(leaseBefore.verified_at);
    expect(leaseAfter.cleanup_policy).toBe(leaseBefore.cleanup_policy);
    expect(leaseAfter.owner_metadata).toBe(leaseBefore.owner_metadata);
    expect(leaseAfter.git_common_dir).toBe(leaseBefore.git_common_dir);

    // No lease row was created at the duplicate path.
    expect(
      getDb().query("SELECT lease_id FROM worktree_leases WHERE worktree_path = ?").get(dupDir),
    ).toBeNull();

    // Termination: a second sweep pass refuses identically, the lease never
    // moves and the original path never becomes no-lease — no flip-flop.
    const second = attempt();
    expect(second).toBeInstanceOf(WorktreeError);
    expect((second as WorktreeError).code).toBe("DUPLICATE_CHECKOUT");
    const listed = listWorktrees({ now: new Date() });
    expect(listed.entries.find((entry) => entry.path === owned.path)?.lease_id).toBe(owned.lease.lease_id);
    expect(listed.entries.find((entry) => entry.path === owned.path)?.issues).not.toContain("no-lease");
    expect(listed.entries.find((entry) => entry.path === dupDir)?.lease_id).toBeNull();
  });

  // PLA8-00242 — the DISTINCT-checkout class: the claim-key collision row
  // belongs to a different checkout (different git common dir) of the same
  // logical worktree. That is the case the reconciliation may settle by moving
  // the lease onto the operator's explicitly adopted path: one lease row per
  // logical worktree, never two rows and never a leaked constraint.
  test("--apply reconciles a distinct-checkout collision by moving the lease", () => {
    const { root, clonePath, repoName } = seed();
    const owned = addWorktree({ repo: repoName, task: "dup-checkout" });

    // A second, genuinely separate checkout of the same repo (same indexed
    // remote identity -> same repo_id in the lease claim key) with its own git
    // common dir.
    const clone2 = join(dirname(clonePath), "clone-2");
    git(dirname(clone2), ["clone", join(dirname(clonePath), "origin.git"), clone2]);
    getDb()
      .prepare(
        "INSERT INTO repos (path, name, org, remote_url, default_branch, updated_at) VALUES (?, ?, 'hasna', ?, 'main', ?)",
      )
      .run(clone2, "open-fixture-2", `github.com/hasna/${repoName}`, "2026-07-01 00:00:00");

    const dupDir = join(root, "other-namespace", "dup-checkout");
    mkdirSync(dirname(dupDir), { recursive: true });
    git(clone2, ["worktree", "add", "-b", "dup-copy-branch", dupDir]);

    const result = adoptWorktrees({ path: dupDir, apply: true });
    expect(result.applied).toBe(true);
    expect(result.adopted).toHaveLength(1);
    expect(result.adopted[0]!.lease_id).toBe(owned.lease.lease_id);

    // One lease row for the logical worktree, moved onto the adopted path and
    // still claimed.
    const rows = getDb()
      .query("SELECT lease_id, worktree_path, status FROM worktree_leases WHERE worktree_path IN (?, ?)")
      .all(owned.path, dupDir) as { lease_id: string; worktree_path: string; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lease_id).toBe(owned.lease.lease_id);
    expect(rows[0]!.worktree_path).toBe(dupDir);
    expect(rows[0]!.status).toBe("claimed");

    // `repos worktree list` sees the lease on the adopted path and none on the
    // original path.
    const listed = listWorktrees({ now: new Date() });
    expect(listed.entries.find((entry) => entry.path === dupDir)?.lease_id).toBe(owned.lease.lease_id);
    expect(listed.entries.find((entry) => entry.path === owned.path)?.lease_id).toBeNull();
  });
});

describe("releaseWorktree", () => {
  test("a clean lease under delete-if-clean is torn down and marked released", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "release-clean" });
    const result = releaseWorktree({ leaseId: created.lease.lease_id });
    expect(result.lease.status).toBe("released");
    expect(result.removed).toBe(true);
    expect(existsSync(created.path)).toBe(false);
  });

  test("--keep releases the lease and leaves the directory in place", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "release-keep" });
    const result = releaseWorktree({ leaseId: created.lease.lease_id, keep: true });
    expect(result.lease.status).toBe("released");
    expect(result.removed).toBe(false);
    expect(existsSync(created.path)).toBe(true);
  });

  test("a dirty lease is not torn down by release", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "release-dirty" });
    writeFileSync(join(created.path, "README.md"), "uncommitted\n");
    const result = releaseWorktree({ leaseId: created.lease.lease_id });
    expect(result.removed).toBe(false);
    expect(result.refusal).toBe("WORKTREE_DIRTY");
    expect(existsSync(created.path)).toBe(true);
  });

  // O15-00583 / O15-00584 — a lease must never be stranded by a worktree that
  // is already gone. When the worktree directory was removed (or its `.git`
  // pointer pruned) while the directory and lease row remain, `removeWorktree`
  // refuses with NOT_A_WORKTREE and the old code recorded the refusal and kept
  // the lease claimed forever — no path ever marked it released. Release of a
  // worktree that no longer exists has nothing to protect, so it completes.
  test("release completes when the worktree directory is already gone (missing-directory strand)", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "release-gone-dir" });
    rmSync(created.path, { recursive: true, force: true });
    const result = releaseWorktree({ leaseId: created.lease.lease_id });
    expect(result.lease.status).toBe("released");
    expect(result.refusal).toBeNull();
    expect(result.removed).toBe(true);
  });

  test("release completes when the worktree .git pointer is gone (pruned-registration strand)", () => {
    const { repoName } = seed();
    const created = addWorktree({ repo: repoName, task: "release-gone-pointer" });
    rmSync(join(created.path, ".git"));
    const result = releaseWorktree({ leaseId: created.lease.lease_id });
    expect(result.lease.status).toBe("released");
    expect(result.refusal).toBeNull();
    // The directory is untracked detritus now; release keeps it rather than
    // deleting unknown content, and reports that it was not removed.
    expect(result.removed).toBe(false);
    expect(existsSync(created.path)).toBe(true);
  });
});
