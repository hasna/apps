/** Runs only inside an admitted disposable image; never imports host application code. */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const input = await Bun.stdin.json();
const requireImage = createRequire("/app/package.json");
const check = (condition: unknown, code: string) => { if (!condition) throw new Error(code); };
const storage = await import("/app/src/storage-kit/index.ts");
const { emailsSelfHostedMigrations } = await import("/app/src/server/self-hosted/migrations.ts");
const migrations = emailsSelfHostedMigrations();
const inventory = Object.fromEntries(migrations.map((row: any) => [row.id, row.checksum]));
let client: any;
let stage = "START";
async function database() {
  client = storage.createQueryClient(storage.createPgPool({ connectionString: input.database_url, env: { PGSSLMODE: "disable" } }));
  return client;
}

async function run() {
  if (input.action === "inventory") return { migrations: inventory, arch: process.arch,
    version: JSON.parse(readFileSync("/app/package.json", "utf8")).version, bun_version: Bun.version };
  const db = await database();
  if (input.action === "bootstrap") {
    stage = "MIGRATE";
    await new storage.MigrationLedger(db, migrations).migrate();
    stage = "CREATE_ROLE";
    check(/^[a-f0-9]{64}$/.test(input.runtime_password), "SYNTHETIC_PASSWORD_FORMAT");
    await db.execute(`CREATE ROLE pair_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${input.runtime_password}'`);
    await db.execute("GRANT CONNECT ON DATABASE pair_fixture TO pair_runtime");
    await db.execute("GRANT USAGE ON SCHEMA public TO pair_runtime");
    await db.execute("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO pair_runtime");
    await db.execute("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO pair_runtime");
    const { ApiKeyStore } = requireImage("@hasna/contracts/auth");
    const { issueSelfHostedApiKey } = await import("/app/src/server/self-hosted/keys.ts");
    const tenants = [];
    for (const letter of ["a", "b"]) {
      stage = "INSERT_TENANT";
      const tenant = await db.one("INSERT INTO tenants(slug,name) VALUES($1,$1) RETURNING id", [`pair-${letter}`]);
      stage = "ISSUE_KEY";
      const minted = await issueSelfHostedApiKey(new ApiKeyStore(db), input.signing_secret, { agent: "isolated-acceptance" });
      stage = "BIND_KEY";
      await db.execute("INSERT INTO api_key_tenants(kid,tenant_id) VALUES($1,$2)", [minted.kid, tenant.id]);
      stage = "INSERT_DOMAIN";
      await db.execute("INSERT INTO domains(id,domain,status,verified,tenant_id) VALUES($1,$2,'verified',true,$3)", [`pair-domain-${letter}`, `${letter}.example.test`, tenant.id]);
      stage = "INSERT_ADDRESS";
      await db.execute("INSERT INTO addresses(id,email,domain,display_name,status,tenant_id) VALUES($1,$2,$3,'Synthetic Sender','active',$4)",
        [`pair-address-${letter}`, `sender@${letter}.example.test`, `${letter}.example.test`, tenant.id]);
      tenants.push({ id: tenant.id, token: minted.token, email: `sender@${letter}.example.test` });
    }
    return { tenants, migrations: inventory };
  }
  if (input.action === "ledger") {
    const first = migrations[0];
    if (input.mode === "missing") await db.execute("DELETE FROM schema_migrations WHERE id=$1", [first.id]);
    else if (input.mode === "checksum") await db.execute("UPDATE schema_migrations SET checksum=$1 WHERE id=$2", [`sha256:${"0".repeat(64)}`, first.id]);
    else if (input.mode === "unknown") await db.execute("INSERT INTO schema_migrations(id,checksum) VALUES('pair_unknown',$1)", [`sha256:${"1".repeat(64)}`]);
    else if (input.mode === "restore") {
      await db.execute("DELETE FROM schema_migrations WHERE id='pair_unknown'");
      await db.execute("INSERT INTO schema_migrations(id,checksum) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET checksum=EXCLUDED.checksum", [first.id, first.checksum]);
    } else throw new Error("LEDGER_MODE");
    return { mode: input.mode };
  }
  if (input.action === "rls") {
    const role = await db.one("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    check(!role.rolsuper && !role.rolbypassrls, "RLS_ROLE_BYPASS");
    const tables = await db.many("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('messages','domains','addresses')");
    check(tables.length === 3 && tables.every((r: any) => r.relrowsecurity && r.relforcerowsecurity), "RLS_TABLE_FENCE");
    check((await db.many("SELECT id FROM domains")).length === 0, "RLS_UNSCOPED_READ");
    // A single SQL statement pins tenant context and read to the same connection.
    const rows = await db.many("WITH scope AS MATERIALIZED (SELECT set_config('app.current_tenant',$1,true)) SELECT d.domain FROM scope CROSS JOIN domains d", [input.tenant_id]);
    check(rows.length === 1 && rows[0].domain === "a.example.test", "RLS_CROSS_TENANT_READ");
    return { role_subject_to_rls: true, forced_tables: tables.map((r: any) => r.relname).sort(), scoped_rows: rows.length };
  }
  if (input.action === "messages") {
    const rows = await db.many("SELECT tenant_id::text,source_id,to_addrs FROM messages WHERE source_id=$1 ORDER BY tenant_id", [input.source_id]);
    return { rows };
  }
  throw new Error("TASK_ACTION");
}
try { console.log(JSON.stringify(await run())); }
catch (error) {
  const sqlstate = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? `_SQLSTATE_${error.code}` : "";
  const kind = error instanceof TypeError ? "_TYPE" : error instanceof ReferenceError ? "_REFERENCE" : "";
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : `IMAGE_TASK_${stage}_FAILED${sqlstate}${kind}`;
  console.log(JSON.stringify({ error: code })); process.exitCode = 1;
}
finally { await client?.close(); }
