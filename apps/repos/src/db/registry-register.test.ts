import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeDb, getDb } from "./database.js";
import { registerRepository, type RegistryRegisterRequest } from "./registry-register.js";

let temp = "";
let target = "";
let dbPath = "";
let request: RegistryRegisterRequest;
let oldMask = 0;
const oldDb = process.env.HASNA_REPOS_DB_PATH;
function git(...args: string[]) {
  return execFileSync("git", ["-C", target, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
function inspect<T>(fn: (db: Database) => T): T {
  const db = new Database(dbPath, { readonly: true, create: false });
  try { return fn(db); } finally { db.close(); }
}
function reviewed() {
  const plan = registerRepository(request);
  return { ...request, apply: true, expectedDatabasePath: dbPath, expectedPlanHash: plan.plan.plan_hash };
}
beforeEach(() => {
  oldMask = process.umask(0o077);
  closeDb();
  temp = mkdtempSync(join(tmpdir(), "repos-register-")); chmodSync(temp, 0o700);
  target = join(temp, "alumia"); mkdirSync(target, { mode: 0o700 });
  dbPath = join(temp, "repos.db"); process.env.HASNA_REPOS_DB_PATH = dbPath;
  const db = getDb();
  db.query("INSERT INTO repos (path,name,org,remote_url) VALUES (?, 'other', 'fixture', 'github.com/fixture/other')").run(join(temp, "unrelated"));
  db.query("INSERT INTO automation_state(key,value) VALUES ('fixture', '{\"preserve\":true}')").run();
  closeDb(); chmodSync(dbPath, 0o600);
  git("init", "-b", "main");
  git("config", "user.name", "Registration Fixture"); git("config", "user.email", "fixture@invalid.example");
  git("remote", "add", "origin", "git@github.com:fixture/alumia.git");
  writeFileSync(join(target, "README.md"), "synthetic source\n");
  git("add", "README.md"); git("commit", "-m", "fixture");
  chmodSync(join(target, ".git"), 0o700);
  request = { path: target, expectedRemote: "github.com/fixture/alumia", expectedHead: git("rev-parse", "HEAD"), expectedBranch: "main" };
});
afterEach(() => {
  closeDb();
  if (oldDb === undefined) delete process.env.HASNA_REPOS_DB_PATH; else process.env.HASNA_REPOS_DB_PATH = oldDb;
  rmSync(temp, { recursive: true, force: true });
  process.umask(oldMask);
});

describe("exact existing-checkout registration", () => {
  it("plans without bootstrap, migrations, hooks, Git writes, or registry writes", () => {
    const before = { db: hash(dbPath), index: hash(join(target, ".git/index")), config: hash(join(target, ".git/config")) };
    const plan = registerRepository(request);
    expect(plan.applied).toBe(false);
    expect(plan.plan.row).toEqual({ path: target, name: "alumia", org: "fixture", remote_url: "github.com/fixture/alumia", default_branch: "main" });
    expect(plan.plan.plan_hash).toMatch(/^[a-f0-9]{64}$/);
    expect({ db: hash(dbPath), index: hash(join(target, ".git/index")), config: hash(join(target, ".git/config")) }).toEqual(before);
    expect(existsSync(join(target, ".git/hooks/post-commit"))).toBe(false);
    expect(inspect(db => db.query("SELECT count(*) AS n FROM repos").get())).toEqual({ n: 1 });
  });

  it("inserts just the planned row and preserves other rows, leases, and automation", () => {
    const other = inspect(db => db.query("SELECT * FROM repos").all());
    const controls = inspect(db => db.query("SELECT * FROM automation_state").all());
    const index = hash(join(target, ".git/index"));
    const applied = registerRepository(reviewed());
    expect(applied.applied).toBe(true); expect(applied.inserted).toBe(1);
    expect(inspect(db => db.query("SELECT * FROM repos WHERE name='other'").all())).toEqual(other);
    expect(inspect(db => db.query("SELECT * FROM automation_state").all())).toEqual(controls);
    expect(inspect(db => db.query("SELECT count(*) AS n FROM worktree_leases").get())).toEqual({ n: 0 });
    expect(hash(join(target, ".git/index"))).toBe(index);
    expect(existsSync(join(target, ".git/hooks/post-commit"))).toBe(false);
  });

  it("repeats an exact registration without updating the existing row", () => {
    const apply = reviewed(); registerRepository(apply);
    const before = inspect(db => db.query("SELECT * FROM repos").all());
    const replay = registerRepository(apply);
    expect(replay.applied).toBe(false); expect(replay.already_registered).toBe(true);
    expect(inspect(db => db.query("SELECT * FROM repos").all())).toEqual(before);
  });

  it("requires the resolved database and plan hash for apply", () => {
    expect(() => registerRepository({ ...request, apply: true })).toThrow("CONFIRMATION_REQUIRED");
    expect(() => registerRepository({ ...reviewed(), expectedDatabasePath: join(temp, "other.db") })).toThrow("DATABASE_MISMATCH");
    expect(() => registerRepository({ ...reviewed(), expectedPlanHash: "0".repeat(64) })).toThrow("PLAN_HASH_MISMATCH");
  });

  it("refuses changed HEAD and branch without any registration", () => {
    expect(() => registerRepository({ ...request, expectedHead: "0".repeat(40) })).toThrow("HEAD_MISMATCH");
    expect(() => registerRepository({ ...request, expectedBranch: "other" })).toThrow("BRANCH_MISMATCH");
  });

  it("refuses a credential-bearing expected identity without echoing it", () => {
    expect(() => registerRepository({ ...request, expectedRemote: "https://example-user@example.invalid/fixture/alumia" })).toThrow("INVALID_REQUEST");
  });

  it("refuses remote drift and a conflicting existing row", () => {
    git("remote", "set-url", "origin", "https://github.com/fixture/different.git");
    expect(() => registerRepository(request)).toThrow("REMOTE_MISMATCH");
    git("remote", "set-url", "origin", "https://github.com/fixture/alumia.git");
    const db = new Database(dbPath); db.query("INSERT INTO repos(path,name,org,remote_url) VALUES (?, 'wrong', 'fixture', 'github.com/fixture/wrong')").run(target); db.close();
    expect(() => registerRepository(request)).toThrow("EXISTING_ROW_CONFLICT");
  });

  it("refuses aliased paths and a linked .git authority", () => {
    mkdirSync(join(temp, "alias")); const alias = join(temp, "alias", "alumia"); symlinkSync(target, alias);
    expect(() => registerRepository({ ...request, path: alias })).toThrow("PATH_UNTRUSTED");
    const otherGit = join(temp, "git-authority");
    renameSync(join(target, ".git"), otherGit); symlinkSync(otherGit, join(target, ".git"));
    expect(() => registerRepository(request)).toThrow("PATH_UNTRUSTED");
  });

  it("does not create a missing registry or run migrations in an old one", () => {
    const missing = join(temp, "missing.db"); process.env.HASNA_REPOS_DB_PATH = missing;
    expect(() => registerRepository(request)).toThrow("DATABASE_UNAVAILABLE"); expect(existsSync(missing)).toBe(false);
    const old = new Database(missing); old.exec("CREATE TABLE unrelated(value TEXT)"); old.close();
    const before = hash(missing); expect(() => registerRepository(request)).toThrow("SCHEMA_UNSUPPORTED"); expect(hash(missing)).toBe(before);
  });

  it("refuses relevant live leases without changing their state", () => {
    const db = new Database(dbPath);
    db.query(`INSERT INTO worktree_leases (lease_id,repo_id,repo_path,machine_id,worktree_path,branch,
      base_ref,base_sha,task_id,run_id,mode,cleanup_policy,status,created_at,updated_at,claimed_at)
      VALUES ('fixture-lease','github:fixture/alumia',?,'fixture',?,'main','main',?,'fixture','fixture',
      'manual','keep','claimed','fixture','fixture','fixture')`).run(target, target, request.expectedHead);
    db.close();
    const before = inspect(db => db.query("SELECT * FROM worktree_leases").all());
    expect(() => registerRepository(request)).toThrow("ACTIVE_LEASE_CONFLICT");
    expect(inspect(db => db.query("SELECT * FROM worktree_leases").all())).toEqual(before);
  });

  it("binds the reviewed raw index to the apply plan", () => {
    const apply = reviewed();
    writeFileSync(join(target, ".git/index"), Buffer.concat([readFileSync(join(target, ".git/index")), Buffer.from([0]) ]));
    expect(() => registerRepository(apply)).toThrow("PLAN_HASH_MISMATCH");
    expect(inspect(db => db.query("SELECT count(*) AS n FROM repos").get())).toEqual({ n: 1 });
  });

  it("refuses a registry alias for the same physical checkout", () => {
    const alias = join(temp, "other-spelling"); symlinkSync(target, alias);
    const db = new Database(dbPath); db.query("INSERT INTO repos(path,name,org,remote_url) VALUES (?,'alumia','fixture','github.com/fixture/alumia')").run(alias); db.close();
    expect(() => registerRepository(request)).toThrow("EXISTING_PATH_ALIAS");
  });

  it("refuses SQLite sidecar symlinks before opening the registry", () => {
    const victim = join(temp, "outside"); writeFileSync(victim, "preserve\n");
    if (existsSync(dbPath + "-wal")) renameSync(dbPath + "-wal", dbPath + ".saved-wal");
    symlinkSync(victim, dbPath + "-wal");
    expect(() => registerRepository(request)).toThrow("DATABASE_UNAVAILABLE");
    expect(readFileSync(victim, "utf8")).toBe("preserve\n");
  });

  it("refuses unknown insertion triggers that could change unrelated rows", () => {
    const db = new Database(dbPath);
    db.exec("CREATE TRIGGER unrelated_effect AFTER INSERT ON repos BEGIN UPDATE repos SET description='unexpected' WHERE name='other'; END");
    db.close();
    const before = inspect(db => db.query("SELECT * FROM repos").all());
    expect(() => registerRepository(request)).toThrow("SCHEMA_UNSUPPORTED");
    expect(inspect(db => db.query("SELECT * FROM repos").all())).toEqual(before);
  });

  it("keeps the CLI registry command outside auto-bootstrap", () => {
    const invoke = (extra: string[]) => Bun.spawnSync({
      cmd: [process.execPath, "--no-env-file", "run", "src/cli/index.tsx", "registry", "register", target,
        "--expected-remote", request.expectedRemote, "--expected-head", request.expectedHead,
        "--expected-branch", "main", "--json", ...extra],
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, HASNA_REPOS_AUTO_BOOTSTRAP: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const before = inspect(db => db.query("SELECT * FROM automation_state").all());
    const dry = invoke([]); expect(dry.exitCode).toBe(0);
    const plan = JSON.parse(dry.stdout.toString());
    const applied = invoke(["--apply", "--expected-database", dbPath, "--expected-plan-hash", plan.plan.plan_hash]);
    expect(applied.exitCode).toBe(0); expect(JSON.parse(applied.stdout.toString()).inserted).toBe(1);
    expect(inspect(db => db.query("SELECT * FROM automation_state").all())).toEqual(before);
    expect(existsSync(join(target, ".git/hooks/post-commit"))).toBe(false);
  });
});
