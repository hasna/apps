import {test,expect} from "bun:test";
import {Database} from "bun:sqlite";
import {createHash} from "node:crypto";
import {MIGRATIONS} from "./migrations.js";
import {runMigrations} from "./schema.js";
import {deterministicPrGroupAttemptId} from "../pr-groups/ledger.js";
const T0="2026-07-23T10:00:00.000Z";
function legacyFixture(){
    const upgradeDb = new Database(":memory:");
    runMigrations(upgradeDb);
    const legacyRoot = "legacy-root";
    const legacyRepository = "hasna/todos";
    const legacyLeaf = "legacy-leaf";
    const legacyBranch = "feat/legacy";
    const legacyDispatch = "legacy-dispatch";
    const legacyGeneration = "legacy-generation";
    const legacyIdentity = createHash("sha256")
      .update(`pr-group:v1\0${legacyRoot}\0${legacyRepository}`)
      .digest("hex");
    const legacyGroupId = `prg_${legacyIdentity.slice(0, 32)}`;
    const legacyAttemptId = deterministicPrGroupAttemptId(
      legacyGroupId,
      legacyLeaf,
      legacyDispatch,
    );
    upgradeDb.exec(`
      PRAGMA foreign_keys = ON;
      DROP TABLE pr_group_events;
      DROP TABLE pr_group_attempts;
      DROP TABLE pr_groups;
      DELETE FROM _migrations WHERE id > 65;
      CREATE TABLE pr_groups (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        identity_key TEXT NOT NULL UNIQUE,
        root_request_id TEXT NOT NULL,
        repository TEXT NOT NULL,
        state TEXT NOT NULL,
        active_attempt_id TEXT,
        active_generation TEXT,
        terminal_attempt_id TEXT,
        terminal_generation TEXT,
        terminal_outcome TEXT,
        terminal_head_sha TEXT,
        terminal_at TEXT,
        cleanup_eligible_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pr_group_attempts (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES pr_groups(id) ON DELETE CASCADE,
        leaf_task_id TEXT NOT NULL,
        dispatch_attempt TEXT NOT NULL,
        writer_generation TEXT NOT NULL,
        previous_attempt_id TEXT REFERENCES pr_group_attempts(id) ON DELETE SET NULL,
        worktree TEXT NOT NULL,
        branch TEXT NOT NULL,
        provider TEXT,
        provider_run_id TEXT,
        profile_alias TEXT,
        status TEXT NOT NULL,
        admitted_at TEXT NOT NULL,
        started_at TEXT,
        last_heartbeat_at TEXT,
        handed_off_at TEXT,
        fenced_at TEXT,
        terminal_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pr_group_events (
        schema_version INTEGER NOT NULL DEFAULT 1,
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES pr_groups(id) ON DELETE CASCADE,
        attempt_id TEXT NOT NULL REFERENCES pr_group_attempts(id) ON DELETE CASCADE,
        writer_generation TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        state TEXT NOT NULL,
        message TEXT,
        head_sha TEXT,
        receipt_key TEXT,
        outcome TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO pr_groups (
        id, identity_key, root_request_id, repository, state,
        active_attempt_id, active_generation, created_at, updated_at
      ) VALUES (
        '${legacyGroupId}', '${legacyIdentity}', '${legacyRoot}', '${legacyRepository}', 'admitted',
        '${legacyAttemptId}', '${legacyGeneration}', '${T0}', '${T0}'
      );
      INSERT INTO pr_group_attempts (
        id, group_id, leaf_task_id, dispatch_attempt, writer_generation,
        worktree, branch, provider, status, admitted_at, created_at, updated_at
      ) VALUES (
        '${legacyAttemptId}', '${legacyGroupId}', '${legacyLeaf}', '${legacyDispatch}', '${legacyGeneration}',
        '/tmp/legacy', '${legacyBranch}', 'codewith', 'admitted', '${T0}', '${T0}', '${T0}'
      );
      INSERT INTO pr_group_events (
        id, group_id, attempt_id, writer_generation, sequence, idempotency_key,
        event_type, state, payload_hash, created_at
      ) VALUES (
        'legacy-event', '${legacyGroupId}', '${legacyAttemptId}', '${legacyGeneration}', 1,
        'admission:${legacyAttemptId}', 'admission', 'admitted', '${"d".repeat(64)}', '${T0}'
      );
    `);

 return {db:upgradeDb,id:legacyGroupId};
}
test("PR-group historical upgrade preserves rows and restores FK state after a rebuild statement failure",()=>{
 const {db,id}=legacyFixture(); const original=MIGRATIONS[67]!;
 try {
  MIGRATIONS[67]=original.replace("DROP TABLE pr_group_events_v66;","INSERT INTO fixture_missing_table VALUES(1);\nDROP TABLE pr_group_events_v66;");
  expect(()=>runMigrations(db)).toThrow();
  expect(db.query("SELECT count(*) AS n FROM pr_groups WHERE id=?").get(id)).toEqual({n:1});
  expect(db.query("SELECT count(*) AS n FROM pr_group_attempts").get()).toEqual({n:1});
  expect(db.query("SELECT count(*) AS n FROM pr_group_events").get()).toEqual({n:1});
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1});
  expect(db.query("SELECT count(*) AS n FROM _migrations WHERE id>=68").get()).toEqual({n:0});
  MIGRATIONS[67]=original;runMigrations(db);
  expect(db.query("SELECT leaf_task_id,branch FROM pr_groups WHERE id=?").get(id)).toEqual({leaf_task_id:"legacy-leaf",branch:"feat/legacy"});
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
 }finally{MIGRATIONS[67]=original;db.close();}
});

test("failed lineage backfill rolls back added columns and never reaches the rebuild",()=>{
 const {db,id}=legacyFixture();const original=MIGRATIONS[66]!;
 try{
  db.exec("PRAGMA foreign_keys = OFF");
  MIGRATIONS[66]=original.replace("ALTER TABLE pr_groups ADD COLUMN branch TEXT;","INSERT INTO fixture_missing_table VALUES(1);\nALTER TABLE pr_groups ADD COLUMN branch TEXT;");
  expect(()=>runMigrations(db)).toThrow();
  expect(db.query("SELECT count(*) AS n FROM pr_groups WHERE id=?").get(id)).toEqual({n:1});
  expect(db.query("PRAGMA table_info(pr_groups)").all().some((row:any)=>row.name==='leaf_task_id')).toBe(false);
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:0});
  expect(db.query("SELECT count(*) AS n FROM _migrations WHERE id>=67").get()).toEqual({n:0});
  MIGRATIONS[66]=original;runMigrations(db);
  expect(db.query("SELECT leaf_task_id FROM pr_groups WHERE id=?").get(id)).toEqual({leaf_task_id:'legacy-leaf'});
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:0});
 }finally{MIGRATIONS[66]=original;db.close();}
});

test("lineage backfill chooses active attempt before an older historical attempt",()=>{
 const {db,id}=legacyFixture();
 try{
  db.exec(`INSERT INTO pr_group_attempts SELECT schema_version,'older-attempt',group_id,'older-leaf','older-dispatch','older-generation',NULL,worktree,'older-branch',provider,provider_run_id,profile_alias,status,'2000-01-01T00:00:00.000Z',started_at,last_heartbeat_at,handed_off_at,fenced_at,terminal_at,'2000-01-01T00:00:00.000Z',updated_at FROM pr_group_attempts LIMIT 1`);
  runMigrations(db);
  expect(db.query("SELECT leaf_task_id,branch FROM pr_groups WHERE id=?").get(id)).toEqual({leaf_task_id:'legacy-leaf',branch:'feat/legacy'});
  expect(db.query("SELECT count(*) AS n FROM pr_group_attempts").get()).toEqual({n:2});
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
 }finally{db.close();}
});

test("missing historical lineage refuses without committing partial columns or dropping groups",()=>{
 const {db,id}=legacyFixture();
 try{
  db.exec("DELETE FROM pr_group_events; DELETE FROM pr_group_attempts;");
  expect(()=>runMigrations(db)).toThrow('incomplete');
  expect(db.query("SELECT count(*) AS n FROM pr_groups WHERE id=?").get(id)).toEqual({n:1});
  expect(db.query("PRAGMA table_info(pr_groups)").all().some((row:any)=>row.name==='leaf_task_id')).toBe(false);
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1});
  expect(db.query("SELECT count(*) AS n FROM _migrations WHERE id>=67").get()).toEqual({n:0});
 }finally{db.close();}
});
