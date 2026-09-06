import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";
import {
  assertCloudSchemaContract,
  assertCloudSchemaReady,
  pingCloudConnectivity,
  pingCloudReadiness,
} from "./cloud-readiness.js";
import type { PgAdapterAsync } from "../db/remote-storage.js";
import { sliceBetween } from "../__tests__/helpers/source-assertions";

const REQUIRED_COLUMNS = {
  projects: {
    id: ["text", false], name: ["text", false], path: ["text", false],
    description: ["text", true], created_at: ["text", false], updated_at: ["text", false],
  },
  agents: {
    id: ["text", false], name: ["text", false], description: ["text", true],
    role: ["text", true], metadata: ["text", true], created_at: ["text", false],
    last_seen_at: ["text", false], active_project_id: ["text", true],
  },
  recordings: {
    id: ["text", false], audio_path: ["text", true], raw_text: ["text", false],
    audio_object_key: ["text", true], audio_sha256: ["text", true],
    audio_bytes: ["bigint", true],
    processed_text: ["text", true], processing_mode: ["text", false],
    model_used: ["text", false], enhancement_model: ["text", true],
    duration_ms: ["integer", true], language: ["text", true], tags: ["text", true],
    agent_id: ["text", true], project_id: ["text", true], session_id: ["text", true],
    goal: ["text", true], role: ["text", true], task_list_id: ["text", true],
    machine_id: ["text", true], metadata: ["text", true], created_at: ["text", false],
  },
  recording_tags: { recording_id: ["text", false], tag: ["text", false] },
  feedback: {
    id: ["text", false], message: ["text", false], email: ["text", true],
    category: ["text", true], version: ["text", true], machine_id: ["text", true],
    created_at: ["text", false],
  },
  api_keys: {
    kid: ["text", false], app: ["text", false], agent: ["text", true],
    scopes: ["jsonb", false], token_hash: ["text", false],
    issued_at: ["timestamp with time zone", false], expires_at: ["timestamp with time zone", true],
    revoked_at: ["timestamp with time zone", true], revoked_reason: ["text", true],
    last_used_at: ["timestamp with time zone", true], created_by: ["text", true],
    created_at: ["timestamp with time zone", false],
  },
  recording_idempotency: {
    principal: ["text", false], idempotency_key: ["text", false],
    request_fingerprint: ["text", false], recording_id: ["text", true],
    created_at: ["text", false],
  },
} as const;

const READY_COLUMNS = Object.entries(REQUIRED_COLUMNS).flatMap(([table_name, columns]) =>
  Object.entries(columns).map(([column_name, [data_type, nullable]]) => ({
    table_name,
    column_name,
    data_type,
    is_nullable: nullable ? "YES" : "NO",
  })),
);

const READY_CONSTRAINTS = [
  {
    table_name: "projects", constraint_type: "p", columns: ["id"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "projects", constraint_type: "u", columns: ["path"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "agents", constraint_type: "p", columns: ["id"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "agents", constraint_type: "u", columns: ["name"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "agents", constraint_type: "f", columns: ["active_project_id"],
    referenced_schema: "public", referenced_table: "projects", referenced_columns: ["id"], delete_action: "n",
  },
  {
    table_name: "recordings", constraint_type: "p", columns: ["id"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "recordings", constraint_type: "f", columns: ["agent_id"],
    referenced_schema: "public", referenced_table: "agents", referenced_columns: ["id"], delete_action: "n",
  },
  {
    table_name: "recordings", constraint_type: "f", columns: ["project_id"],
    referenced_schema: "public", referenced_table: "projects", referenced_columns: ["id"], delete_action: "n",
  },
  {
    table_name: "recording_tags", constraint_type: "p", columns: ["recording_id", "tag"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "recording_tags", constraint_type: "f", columns: ["recording_id"],
    referenced_schema: "public", referenced_table: "recordings", referenced_columns: ["id"], delete_action: "c",
  },
  {
    table_name: "feedback", constraint_type: "p", columns: ["id"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "api_keys", constraint_type: "p", columns: ["kid"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "api_keys", constraint_type: "u", columns: ["token_hash"],
    referenced_schema: null, referenced_table: null, referenced_columns: [], delete_action: null,
  },
  {
    table_name: "recording_idempotency",
    constraint_type: "p",
    columns: ["principal", "idempotency_key"],
    referenced_schema: null,
    referenced_table: null,
    referenced_columns: [],
    delete_action: null,
  },
  {
    table_name: "recording_idempotency",
    constraint_type: "u",
    columns: ["recording_id"],
    referenced_schema: null,
    referenced_table: null,
    referenced_columns: [],
    delete_action: null,
  },
  {
    table_name: "recording_idempotency",
    constraint_type: "f",
    columns: ["recording_id"],
    referenced_schema: "public",
    referenced_table: "recordings",
    referenced_columns: ["id"],
    delete_action: "n",
  },
];

for (const constraint of READY_CONSTRAINTS) {
  Object.assign(constraint, {
    is_validated: true,
    is_deferrable: false,
    is_deferred: false,
    update_action: constraint.constraint_type === "f" ? "a" : null,
    match_type: constraint.constraint_type === "f" ? "s" : null,
  });
}

const READY_INDEXES = [
  { table_name: "projects", is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["id"] },
  { table_name: "projects", is_primary: false, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["path"] },
  { table_name: "agents", is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["id"] },
  { table_name: "agents", is_primary: false, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["name"] },
  { table_name: "recordings", is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["id"] },
  { table_name: "recording_tags", is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["recording_id", "tag"] },
  { table_name: "feedback", is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["id"] },
  { table_name: "api_keys", is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["kid"] },
  { table_name: "api_keys", is_primary: false, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["token_hash"] },
  {
    table_name: "recording_idempotency",
    is_primary: true, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["principal", "idempotency_key"],
  },
  {
    table_name: "recording_idempotency",
    is_primary: false, is_unique: true, is_valid: true, nulls_not_distinct: false,
    predicate: null, columns: ["recording_id"],
  },
];

for (const index of READY_INDEXES) {
  Object.assign(index, { is_ready: true });
}

const READY_ROLE = {
  can_recordings: true,
  can_recording_tags: true,
  can_agents: true,
  can_projects: true,
  can_feedback: true,
  can_api_keys: true,
  can_recording_idempotency: true,
  can_use_public: true,
  owner_can_tombstone_recording_idempotency: true,
  owner_can_delete_recording_tags: true,
  is_superuser: false,
  can_create_role: false,
  can_create_database: false,
  can_replicate: false,
  can_bypass_rls: false,
  can_create_in_database: false,
  can_create_temporary_tables: false,
  owns_user_schema: false,
  can_create_in_user_schema: false,
  owns_user_table: false,
  has_extra_recordings_privileges: false,
  has_extra_recording_tags_privileges: false,
  has_extra_agents_privileges: false,
  has_extra_projects_privileges: false,
  has_extra_feedback_privileges: false,
  has_extra_api_keys_privileges: false,
  has_extra_recording_idempotency_privileges: false,
};

function readinessPg(options: {
  columns?: Array<Record<string, unknown>>;
  constraints?: Array<Record<string, unknown>>;
  indexes?: Array<Record<string, unknown>>;
  role?: Record<string, boolean>;
} = {}): PgAdapterAsync {
  return {
    async all(sql: string) {
      if (/FROM pg_constraint/i.test(sql)) return options.constraints ?? READY_CONSTRAINTS;
      if (/FROM pg_index/i.test(sql)) return options.indexes ?? READY_INDEXES;
      return options.columns ?? READY_COLUMNS;
    },
    async get() {
      return options.role ?? READY_ROLE;
    },
  } as unknown as PgAdapterAsync;
}

function pingPg(options: Parameters<typeof readinessPg>[0] = {}): PgAdapterAsync {
  const ready = readinessPg(options);
  return {
    async get(sql: string) {
      return /select\s+1\s+as\s+ok/i.test(sql) ? { ok: 1 } : ready.get(sql);
    },
    all: ready.all.bind(ready),
  } as unknown as PgAdapterAsync;
}

describe("cloud schema readiness", () => {
  test("rejects old-schema/new-code deployment before request traffic", async () => {
    await expect(assertCloudSchemaReady(readinessPg({
      columns: READY_COLUMNS.filter((row) => row.table_name !== "recording_idempotency"),
    }))).rejects.toThrow("recording_idempotency");
  });

  test("rejects a DML-only service role missing a required table privilege", async () => {
    await expect(assertCloudSchemaReady(readinessPg({
      role: { ...READY_ROLE, can_recording_idempotency: false },
    }))).rejects.toThrow("recording_idempotency");
  });

  test("rejects wrong idempotency type/nullability and incomplete constraints", async () => {
    await expect(assertCloudSchemaReady(readinessPg({
      columns: READY_COLUMNS.map((row) => row.table_name === "recording_idempotency" && row.column_name === "recording_id"
        ? { ...row, data_type: "uuid", is_nullable: "NO" }
        : row),
      constraints: READY_CONSTRAINTS.filter((constraint) => !(
        constraint.table_name === "recording_idempotency" && constraint.constraint_type === "u"
      )).map((constraint) =>
        constraint.table_name === "recording_idempotency" && constraint.constraint_type === "f"
          ? { ...constraint, delete_action: "c" }
          : constraint
      ),
    }))).rejects.toThrow("recording_idempotency.recording_id");
  });

  test("rejects missing required base-table columns", async () => {
    await expect(assertCloudSchemaContract(readinessPg({
      columns: READY_COLUMNS.filter((row) => !(row.table_name === "recordings" && row.column_name === "goal")),
    }))).rejects.toThrow("recordings.goal");
  });

  test("catalog constraint/index queries cast key-column ARRAY subqueries to text[]", async () => {
    // Regression (I38-00531): the ARRAY(SELECT attname ...) subqueries produce name[]
    // (pg oid 1003), which node-postgres does NOT parse — the driver returns the raw
    // string "{id}" and sameColumns() always fails, so assertCloudSchemaContract threw
    // "cloud schema has incompatible projects constraints" on every database and the
    // recordings migrate container could never pass. The ::text[] casts force the
    // driver's text[] parser (oid 1009), which returns real arrays.
    const calls: string[] = [];
    const pg = {
      async all(sql: string) {
        calls.push(sql);
        if (/FROM pg_constraint/i.test(sql)) return READY_CONSTRAINTS;
        if (/FROM pg_index/i.test(sql)) return [];
        return READY_COLUMNS;
      },
      async get() {
        return READY_ROLE;
      },
    } as unknown as PgAdapterAsync;
    // With READY_CONSTRAINTS satisfied and no unique indexes, the index loop throws.
    await expect(assertCloudSchemaContract(pg)).rejects.toThrow("unique indexes");
    const constraintSql = calls.find((sql) => /FROM pg_constraint/i.test(sql));
    const indexSql = calls.find((sql) => /FROM pg_index/i.test(sql));
    expect(constraintSql).toBeDefined();
    expect(indexSql).toBeDefined();
    expect(constraintSql!).toMatch(/\)::text\[\] AS columns,/);
    expect(constraintSql!).toMatch(/\)::text\[\] END AS referenced_columns/);
    expect(indexSql!).toMatch(/\)::text\[\] AS columns/);
  });

  test("rejects missing or wrong canonical base-table keys and foreign keys", async () => {
    for (const [table, columns] of [
      ["recordings", ["id"]],
      ["recording_tags", ["recording_id", "tag"]],
      ["api_keys", ["kid"]],
    ] as const) {
      await expect(assertCloudSchemaContract(readinessPg({
        constraints: READY_CONSTRAINTS.filter((constraint) => !(
          constraint.table_name === table && constraint.constraint_type === "p"
        )),
      }))).rejects.toThrow(`${table} constraints`);
    }

    await expect(assertCloudSchemaContract(readinessPg({
      constraints: READY_CONSTRAINTS.map((constraint) =>
        constraint.table_name === "recording_tags" && constraint.constraint_type === "f"
          ? { ...constraint, delete_action: "n" }
          : constraint
      ),
    }))).rejects.toThrow("recording_tags constraints");
  });

  test("rejects missing or invalid canonical unique constraints and indexes", async () => {
    await expect(assertCloudSchemaContract(readinessPg({
      constraints: READY_CONSTRAINTS.filter((constraint) => !(
        constraint.table_name === "api_keys" && constraint.constraint_type === "u"
      )),
    }))).rejects.toThrow("api_keys constraints");

    await expect(assertCloudSchemaContract(readinessPg({
      indexes: READY_INDEXES.map((index) =>
        index.table_name === "recordings" && index.is_primary
          ? { ...index, is_valid: false }
          : index
      ),
    }))).rejects.toThrow("recordings unique indexes");
  });

  test("rejects deferrable keys that runtime ON CONFLICT cannot use as arbiters", async () => {
    await expect(assertCloudSchemaContract(readinessPg({
      constraints: READY_CONSTRAINTS.map((constraint) =>
        constraint.table_name === "recording_idempotency" && constraint.constraint_type === "p"
          ? { ...constraint, is_deferrable: true }
          : constraint
      ),
    }))).rejects.toThrow("recording_idempotency constraints");
  });

  test("rejects canonical FK update, match, or deferral drift", async () => {
    for (const drift of [
      { update_action: "c" },
      { match_type: "f" },
      { is_deferrable: true },
      { is_deferred: true },
    ]) {
      await expect(assertCloudSchemaContract(readinessPg({
        constraints: READY_CONSTRAINTS.map((constraint) =>
          constraint.table_name === "recording_tags" && constraint.constraint_type === "f"
            ? { ...constraint, ...drift }
            : constraint
        ),
      }))).rejects.toThrow("recording_tags constraints");
    }
  });

  test("rejects unexpected idempotency columns that can invalidate repository inserts", async () => {
    await expect(assertCloudSchemaContract(readinessPg({
      columns: [...READY_COLUMNS, {
        table_name: "recording_idempotency",
        column_name: "tenant",
        data_type: "text",
        is_nullable: "NO",
      }],
    }))).rejects.toThrow("unexpected column");
  });

  test("rejects an additional destructive FK and a same-named target outside public", async () => {
    await expect(assertCloudSchemaContract(readinessPg({
      constraints: [...READY_CONSTRAINTS, {
        table_name: "recording_idempotency",
        constraint_type: "f",
        columns: ["recording_id"],
        referenced_schema: "public",
        referenced_table: "recordings",
        referenced_columns: ["id"],
        delete_action: "c",
      }],
    }))).rejects.toThrow("recording_idempotency constraints");
    await expect(assertCloudSchemaContract(readinessPg({
      constraints: READY_CONSTRAINTS.map((constraint) => constraint.table_name === "recording_idempotency" && constraint.constraint_type === "f"
        ? { ...constraint, referenced_schema: "archive" }
        : constraint),
    }))).rejects.toThrow("recording_idempotency constraints");
  });

  test("rejects NULLS NOT DISTINCT or extra unique indexes that break tombstone reuse", async () => {
    await expect(assertCloudSchemaContract(readinessPg({
      indexes: READY_INDEXES.map((index) => index.table_name === "recording_idempotency" && index.columns[0] === "recording_id"
        ? { ...index, nulls_not_distinct: true }
        : index),
    }))).rejects.toThrow("unique indexes");
    await expect(assertCloudSchemaContract(readinessPg({
      indexes: [...READY_INDEXES, {
        table_name: "recording_idempotency",
        is_primary: false,
        is_unique: true,
        is_valid: true,
        nulls_not_distinct: false,
        predicate: null,
        columns: ["principal"],
      }],
    }))).rejects.toThrow("unique indexes");
  });

  test("rejects superuser, ownership, or schema CREATE capability", async () => {
    for (const capability of [
      "is_superuser",
      "can_create_role",
      "can_create_database",
      "can_replicate",
      "can_bypass_rls",
      "can_create_in_database",
      "owns_user_schema",
      "can_create_in_user_schema",
      "owns_user_table",
    ] as const) {
      await expect(assertCloudSchemaReady(readinessPg({
        role: { ...READY_ROLE, [capability]: true },
      }))).rejects.toThrow("DML-only");
    }
  });

  test("rejects database TEMPORARY inherited from the default PUBLIC grant", async () => {
    await expect(assertCloudSchemaReady(readinessPg({
      role: { ...READY_ROLE, can_create_temporary_tables: true },
    }))).rejects.toThrow("DML-only");
  });

  test("rejects a role without public schema USAGE", async () => {
    await expect(assertCloudSchemaReady(readinessPg({
      role: { ...READY_ROLE, can_use_public: false },
    }))).rejects.toThrow("schema USAGE");
  });

  test("rejects surplus privileges beyond each route's directly used operations", async () => {
    for (const capability of [
      "has_extra_recordings_privileges",
      "has_extra_recording_tags_privileges",
      "has_extra_agents_privileges",
      "has_extra_projects_privileges",
      "has_extra_feedback_privileges",
      "has_extra_api_keys_privileges",
      "has_extra_recording_idempotency_privileges",
    ] as const) {
      await expect(assertCloudSchemaReady(readinessPg({
        role: { ...READY_ROLE, [capability]: true },
      }))).rejects.toThrow("surplus table privileges");
    }
  });

  test("rejects revoked owner privileges needed by recording deletion triggers", async () => {
    for (const [capability, table] of [
      ["owner_can_tombstone_recording_idempotency", "recording_idempotency"],
      ["owner_can_delete_recording_tags", "recording_tags"],
    ] as const) {
      await expect(assertCloudSchemaReady(readinessPg({
        role: { ...READY_ROLE, [capability]: false },
      }))).rejects.toThrow(`${table} owner lacks`);
    }
  });

  test("accepts the exact schema contract with only route-required DML grants", async () => {
    const queries: string[] = [];
    const pg = {
      async get(sql: string) {
        queries.push(sql);
        return READY_ROLE;
      },
      async all(sql: string) {
        queries.push(sql);
        if (/FROM pg_constraint/i.test(sql)) return READY_CONSTRAINTS;
        if (/FROM pg_index/i.test(sql)) return READY_INDEXES;
        return READY_COLUMNS;
      },
    } as unknown as PgAdapterAsync;
    await expect(assertCloudSchemaReady(pg)).resolves.toBeUndefined();
    expect(queries.join("\n")).toContain("pg_roles");
    expect(queries.join("\n")).toContain("has_schema_privilege");
    expect(queries.join("\n")).toContain("'TEMPORARY'");
    expect(queries.join("\n")).toContain("'TRUNCATE'");
    expect(queries.join("\n")).toContain("'REFERENCES'");
    expect(queries.join("\n")).toContain("'TRIGGER'");
    expect(queries.join("\n")).toContain("has_any_column_privilege(current_user, 'public.recordings', 'UPDATE')");
    expect(queries.join("\n")).toContain("has_any_column_privilege(current_user, 'public.feedback', 'SELECT')");
    expect(queries.join("\n")).toContain("has_any_column_privilege(current_user, 'public.api_keys', 'INSERT')");
    expect(queries.join("\n")).toContain("has_any_column_privilege(current_user, 'public.recording_idempotency', 'REFERENCES')");
    expect(queries.join("\n")).toContain("to_jsonb(index_row)->>'indnullsnotdistinct'");
    expect(queries.join("\n")).not.toMatch(/'SELECT,INSERT|'INSERT,UPDATE|'SELECT,INSERT,DELETE/);
  });

  test("the readiness probe rejects an incomplete schema despite a healthy connection", async () => {
    await expect(pingCloudReadiness(pingPg({
      columns: READY_COLUMNS.filter((row) => row.table_name !== "recording_idempotency"),
    }))).rejects.toThrow("recording_idempotency");
  });

  test("connectivity is independent of schema readiness", async () => {
    const pg = {
      async get() { return { ok: 1 }; },
    } as unknown as PgAdapterAsync;
    await expect(pingCloudConnectivity(pg)).resolves.toBe(true);
  });

  test("the connectivity probe rejects an unexpected ping result", async () => {
    const pg = {
      async get() {
        return { ok: 0 };
      },
    } as unknown as PgAdapterAsync;
    await expect(pingCloudConnectivity(pg)).rejects.toThrow("cloud database ping failed");
  });
});

describe("cloud migration parity", () => {
  test("the executable and canonical schemas both preserve deleted idempotency tombstones", async () => {
    const canonical = await Bun.file(
      new URL("../../migrations/0001_recordings_schema.sql", import.meta.url),
    ).text();
    const createMigration = PG_MIGRATIONS.find((ddl) =>
      /create table if not exists recording_idempotency/i.test(ddl)
    );
    const tombstoneMigration = PG_MIGRATIONS.find((ddl) =>
      /alter column recording_id drop not null/i.test(ddl)
    );

    // These run BEFORE the shape assertions, which is the only position where they do any work: a
    // `toMatch` against `undefined` already throws, so a presence check placed after one can never
    // be the assertion that fires. Named, they say which migration is missing instead of surfacing
    // as a type error on a regex.
    //
    // `expectOrder` does not apply to the ordering below: the haystack is the migration array, not
    // a source string, so `indexOf` is `Array.prototype`'s. Nor does that ordering carry the -1
    // hole this sweep is about — `find` returns an array MEMBER, and `indexOf` of a member it just
    // returned cannot be -1. The failure mode here is `undefined`, not -1, which is what these two
    // checks cover and why the site keeps a raw comparison.
    expect(createMigration, "no PG migration creates recording_idempotency").toBeDefined();
    expect(
      tombstoneMigration,
      "no PG migration relaxes recording_id for tombstones",
    ).toBeDefined();
    expect(createMigration).toMatch(
      /recording_id\s+text\s+not null\s+unique\s+references\s+recordings\(id\)\s+on delete cascade/i,
    );
    expect(tombstoneMigration).toMatch(/drop constraint if exists recording_idempotency_recording_id_fkey/i);
    expect(tombstoneMigration).toMatch(/alter column recording_id drop not null/i);
    expect(tombstoneMigration).toMatch(/on delete set null/i);
    expect(PG_MIGRATIONS.indexOf(tombstoneMigration!)).toBeGreaterThan(
      PG_MIGRATIONS.indexOf(createMigration!),
    );

    // The canonical schema has to create the table with ON DELETE CASCADE and only later relax it,
    // and the CASCADE claim is made over the region between the two.
    //
    // Unlike the rest of this sweep, this site was ALREADY sound: it guarded its start bound with
    // `toBeGreaterThan(-1)` and its end bound against the start, so neither could be -1. Converting
    // it buys only the non-trivial-region floor and one fewer hand-written guard to get wrong next
    // time. Recorded plainly because claiming a hole here that the previous code did not have would
    // be the same defect as the vacuous assertions this PR removes, one level up.
    const canonicalCreateToUpgrade = sliceBetween(
      canonical,
      "CREATE TABLE IF NOT EXISTS recording_idempotency",
      "ALTER COLUMN recording_id DROP NOT NULL",
    );
    expect(canonicalCreateToUpgrade).toMatch(/on delete cascade/i);
    // Reached only once `sliceBetween` has proven the ALTER exists, so this offset cannot be -1 —
    // which would have sliced the last character and matched nothing.
    const canonicalUpgrade = canonical.indexOf("ALTER COLUMN recording_id DROP NOT NULL");
    expect(canonical.slice(canonicalUpgrade)).toMatch(/on delete set null/i);
  });
});

// ── /v1 auth verifier construction (regression T-00094) ─────────────────────
// @hasna/contracts >= 0.9.0 throws at construction when `verifyApiKey` is wired
// with only the deprecated `isRevoked` hook — it cannot refuse a key this
// service has no record of, so an unregistered key would be irrevocable. The
// 0.3.8/0.3.9/0.3.10 servers shipped that wiring, so every authenticated /v1
// request (GET /recordings, GET /stats, …) landed in the v1.ts catch and
// returned 503 "authentication service unavailable" while /health and /version
// stayed 200. Construction must succeed with the `keyStatus` hook, and a
// request with no token must be denied without touching the database.
//
// The probe runs in a fresh `bun -e` subprocess: `getCloudVerifier` caches its
// result in module scope and other test files mock modules for the whole test
// process, so an in-process assertion could vacuously pass or fail depending
// on file ordering.
const SIGNING_KEY_ENV = [
  "HASNA_RECORDINGS_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
] as const;
const DB_URL_ENV = [
  "HASNA_RECORDINGS_DATABASE_URL",
  "RECORDINGS_DATABASE_URL",
  "DATABASE_URL",
] as const;

const PROBE_SCRIPT = `
import { getCloudVerifier } from "./src/server/cloud.ts";
const verifier = getCloudVerifier();
if (typeof verifier.authenticate !== "function") throw new Error("verifier has no authenticate");
const decision = await verifier.authenticate(new Headers(), {
  method: "GET",
  path: "/v1/recordings",
  requiredScopes: ["recordings:read"],
});
if (decision.ok || decision.status !== 401) {
  throw new Error("expected a 401 missing-token denial, got " + JSON.stringify(decision));
}
console.log("VERIFIER_OK");
`;

function probeCloudEnv(env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const k of [...SIGNING_KEY_ENV, ...DB_URL_ENV]) delete childEnv[k];
  for (const [k, v] of Object.entries(env)) childEnv[k] = v;
  const res = spawnSync(process.execPath, ["-e", PROBE_SCRIPT], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: childEnv,
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe("cloud verifier construction (/v1 auth)", () => {
  test("fails closed when no signing secret is configured", () => {
    const { status, stderr } = probeCloudEnv({});
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/signing secret/i);
  });

  test("constructs with the contracts keyStatus hook and denies a missing token without a database", () => {
    const { status, stdout, stderr } = probeCloudEnv({
      HASNA_RECORDINGS_API_SIGNING_KEY: "test-signing-secret-0123456789abcdef",
      HASNA_RECORDINGS_DATABASE_URL: "postgres://placeholder:placeholder@127.0.0.1:1/placeholder",
    });
    expect(stderr).not.toMatch(/isRevoked|key-status hook/i);
    expect(status).toBe(0);
    expect(stdout).toContain("VERIFIER_OK");
  });
});
