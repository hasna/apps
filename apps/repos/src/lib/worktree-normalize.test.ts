import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, lchmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDb, getDb } from "../db/database.js";
import { adoptWorktrees, listWorktrees, setWorktreeRootForTests } from "./worktrees.js";
import { normalizeWorktree } from "./worktree-normalize.js";

let temp = "";
function git(path: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: path, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "test@example.invalid" } }).trim();
}
function seed() {
  temp = realpathSync(mkdtempSync(join(tmpdir(), "repos-normalize-")));
  const root = join(temp, "worktrees");
  const parent = join(temp, "clone");
  mkdirSync(parent); mkdirSync(root); setWorktreeRootForTests(root);
  git(parent, "init", "--initial-branch=main");
  writeFileSync(join(parent, "tracked"), "original\n");
  writeFileSync(join(parent, ".gitignore"), "ignored\n");
  git(parent, "add", "."); git(parent, "commit", "-m", "seed");
  const db = getDb(join(temp, "repos.db"));
  db.query("INSERT INTO repos (path,name,org,remote_url,default_branch) VALUES (?,?,?,?,?)").run(parent, "demo", "acme", "github.com/acme/demo", "main");
  const source = join(root, "demo", "task");
  const target = join(root, "acme", "demo", "task");
  mkdirSync(dirname(source)); git(parent, "worktree", "add", "-b", "task", source);
  adoptWorktrees({ path: source, apply: true, machineId: "old-station", db });
  return { root, parent, source, target, db };
}
afterEach(() => { closeDb(); setWorktreeRootForTests(null); if (temp) rmSync(temp, { recursive: true, force: true }); temp = ""; });

describe("worktree normalization", () => {
  test.skipIf(process.platform !== "darwin")("preserves symlink permissions in checkpoints, adjusted links and rollback", () => {
    const f = seed();
    const external = join(temp, "external");
    writeFileSync(external, "external\n", { mode: 0o600 });
    symlinkSync("../../../external", join(f.source, "external-link"));
    symlinkSync("tracked", join(f.source, "internal-link"));
    for (const name of ["external-link", "internal-link"]) lchmodSync(join(f.source, name), 0o700);
    const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    const result = normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db });
    for (const name of ["external-link", "internal-link"]) {
      expect(lstatSync(join(f.target, name)).mode & 0o777).toBe(0o700);
      expect(lstatSync(join(result.checkpoint!, "files", name)).mode & 0o777).toBe(0o700);
    }
    expect(readFileSync(join(f.target, "external-link"), "utf8")).toBe("external\n");
    expect(lstatSync(external).mode & 0o777).toBe(0o600);
    expect(normalizeWorktree({ repo: "acme/demo", name: "task", rollback: plan.plan_hash, db: f.db }).action).toBe("rolled-back");
    for (const name of ["external-link", "internal-link"]) expect(lstatSync(join(f.source, name)).mode & 0o777).toBe(0o700);
    expect(readlinkSync(join(f.source, "external-link"))).toBe("../../../external");
    expect(lstatSync(external).mode & 0o777).toBe(0o600);
  });
  test("dry run is read only; apply preserves dirty files, lease identity, aliases and Git registration", () => {
    const f = seed();
    writeFileSync(join(f.source, "tracked"), "staged\n"); git(f.source, "add", "tracked");
    writeFileSync(join(f.source, "tracked"), "unstaged\n");
    writeFileSync(join(f.source, "untracked"), "private work\n");
    writeFileSync(join(f.source, "ignored"), "ignored work\n");
    writeFileSync(join(temp, "external"), "external\n");
    symlinkSync("../../../external", join(f.source, "external-link"));
    const status = git(f.source, "status", "--porcelain=v1");
    const inode = lstatSync(f.source).ino;
    const lease = f.db.query("SELECT * FROM worktree_leases").get() as any;
    const beforeRows = f.db.query("SELECT * FROM repos").all();
    const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    expect(plan.applied).toBe(false); expect(existsSync(f.target)).toBe(false);
    expect(existsSync(join(f.root, ".evidence"))).toBe(false);
    expect(f.db.query("SELECT * FROM repos").all()).toEqual(beforeRows);
    const result = normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db });
    expect(result.applied).toBe(true); expect(lstatSync(f.target).ino).toBe(inode);
    expect(realpathSync(f.source)).toBe(f.target);
    expect(git(f.target, "status", "--porcelain=v1")).toBe(status);
    expect(readFileSync(join(f.target, "untracked"), "utf8")).toBe("private work\n");
    expect(readFileSync(join(f.target, "ignored"), "utf8")).toBe("ignored work\n");
    expect(readFileSync(join(f.target, "external-link"), "utf8")).toBe("external\n");
    expect(readlinkSync(join(f.target, "external-link"))).not.toBe("../../../external");
    const after = f.db.query("SELECT * FROM worktree_leases").get() as any;
    expect(after.lease_id).toBe(lease.lease_id); expect(after.machine_id).toBe("old-station");
    expect(after.worktree_path).toBe(f.target);
    expect(listWorktrees({ db: f.db }).entries.filter(e => e.is_worktree).map(e => e.path)).toEqual([f.target]);
    expect(git(f.parent, "worktree", "list", "--porcelain")).toContain(`worktree ${f.target}`);
    expect(readFileSync(join(result.checkpoint!, "files", "ignored"), "utf8")).toBe("ignored work\n");
    expect(normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db }).action).toBe("already-canonical");
  });
  test("a changed plan or occupied destination leaves the original intact", () => {
    const f = seed(); const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    writeFileSync(join(f.source, "new"), "changed");
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db })).toThrow("plan changed");
    mkdirSync(f.target, { recursive: true });
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db })).toThrow("occupied");
    expect(readFileSync(join(f.source, "new"), "utf8")).toBe("changed");
  });
  test("detached unleased worktrees are moved without inventing ownership", () => {
    const f = seed(); f.db.query("DELETE FROM worktree_leases").run(); git(f.source, "checkout", "--detach");
    const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    const result = normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db });
    expect(result.applied).toBe(true); expect(git(f.target, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(f.db.query("SELECT * FROM worktree_leases").all()).toEqual([]);
  });
  test("rollback uses its receipt to restore paths, links and rows without deleting work", () => {
    const f = seed(); const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db });
    const restored = normalizeWorktree({ repo: "acme/demo", name: "task", rollback: plan.plan_hash, db: f.db });
    expect(restored.action).toBe("rolled-back"); expect(lstatSync(f.source).isSymbolicLink()).toBe(false);
    expect(existsSync(f.target)).toBe(false);
    expect((f.db.query("SELECT worktree_path FROM worktree_leases").get() as any).worktree_path).toBe(f.source);
    // An incomplete file checkpoint from an interrupted copy is retained,
    // and retry makes a fresh checkpoint from the still-intact worktree.
    rmSync(join(restored.checkpoint!, "files", "tracked"));
    const retry = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    expect(normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: retry.plan_hash, db: f.db }).applied).toBe(true);
    expect(existsSync(`${restored.checkpoint}.attempt-1`)).toBe(true);
  });
  test("a database write failure rolls Git and the compatibility alias back", () => {
    const f = seed();
    writeFileSync(join(f.source, "untracked"), "keep me");
    const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    f.db.exec("CREATE TRIGGER refuse_move BEFORE UPDATE OF worktree_path ON worktree_leases BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db })).toThrow("fixture failure");
    expect(lstatSync(f.source).isSymbolicLink()).toBe(false); expect(existsSync(f.target)).toBe(false);
    expect(readFileSync(join(f.source, "untracked"), "utf8")).toBe("keep me");
    expect((f.db.query("SELECT worktree_path FROM worktree_leases").get() as any).worktree_path).toBe(f.source);
    expect(git(f.source, "rev-parse", "--show-toplevel")).toBe(f.source);
  });
  test("rollback recovers an interrupted move with a pre-commit registry", () => {
    const f = seed(); const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    const result = normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db });
    const journalPath = join(result.checkpoint!, "journal.json");
    const receipt = JSON.parse(readFileSync(journalPath, "utf8")); receipt.phase = "moving";
    writeFileSync(journalPath, JSON.stringify(receipt)); rmSync(f.source);
    f.db.query("UPDATE worktree_leases SET worktree_path=?").run(f.source);
    expect(normalizeWorktree({ repo: "acme/demo", name: "task", rollback: plan.plan_hash, db: f.db }).action).toBe("rolled-back");
    expect(git(f.source, "rev-parse", "--show-toplevel")).toBe(f.source);
  });
  test("rollback refuses new work after the move and retains the new files", () => {
    const f = seed(); const plan = normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db });
    normalizeWorktree({ repo: "acme/demo", name: "task", apply: true, expectedPlanHash: plan.plan_hash, db: f.db });
    writeFileSync(join(f.target, "new"), "new work");
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "task", rollback: plan.plan_hash, db: f.db })).toThrow("worktree changed");
    expect(readFileSync(join(f.target, "new"), "utf8")).toBe("new work");
  });
  test("wrong repository ownership, path traversal and symlink destinations are refused", () => {
    const f = seed();
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "../task", db: f.db })).toThrow();
    mkdirSync(join(temp, "elsewhere")); mkdirSync(join(f.root, "acme"));
    symlinkSync(join(temp, "elsewhere"), dirname(f.target));
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db })).toThrow();
    rmSync(dirname(f.target));
    const other = join(temp, "other"); mkdirSync(other); git(other, "init", "--initial-branch=main");
    f.db.query("UPDATE repos SET path=? WHERE name='demo'").run(other);
    expect(() => normalizeWorktree({ repo: "acme/demo", name: "task", db: f.db })).toThrow();
  });
});
