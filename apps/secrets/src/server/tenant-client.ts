import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/index.js";
import { CloudSecretsStore } from "./cloud-store.js";

/** Transaction-local RLS context: never a pooled connection session setting. */
export async function assertTenantSecurity(db: TypedQueryClient): Promise<void> {
  const role = await db.get<{rolsuper:boolean;rolbypassrls:boolean;rls_tables:number;ownership_write:boolean}>("SELECT rolsuper,rolbypassrls,has_table_privilege(current_user,quote_ident(current_schema())||'.secret_key_owners','INSERT,UPDATE,DELETE,TRUNCATE') ownership_write,(SELECT count(*)::int FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('secrets','vault_items','users','feedback','audit_log','secret_versions','vault_migrations','vault_migration_keys') AND relrowsecurity AND relforcerowsecurity) rls_tables FROM pg_roles WHERE rolname=current_user");
  if(!role || role.rolsuper || role.rolbypassrls || role.ownership_write || role.rls_tables!==8) throw new Error("Secrets serving role and schema must enforce row-level security");
}
export async function setTenantContext(db: TypedQueryClient, tenantId: string): Promise<void> {
  await assertTenantSecurity(db);
  await db.execute("SELECT set_config('app.secrets_tenant_id',$1,true)", [tenantId]);
}
const OPERATIONS = new Set([
 "setSecret","getSecret","deleteSecret","pruneExpired","listSecretMetadata","searchSecretMetadata",
 "listVersions","checkVersion","restoreVersion","pruneVersionHistory","runVersionBackfill",
 "setVaultItem","getVaultItem","deleteVaultItem","listVaultItemMetadata","searchVaultItemMetadata",
 "registerUser","listUsers","deleteUser","getAuditLog","addFeedback",
]);
/** One atomic transaction per ordinary store operation, including its history/audit writes. */
export function tenantStore(pool: PoolQueryClient, tenantId: string, kid: string, scopes: string[]): CloudSecretsStore {
  return new Proxy(new CloudSecretsStore(pool), {
    get(target, name, receiver) {
      const method = Reflect.get(target,name,receiver);
      if(typeof name!=="string" || !OPERATIONS.has(name)) return method;
      return (...args: unknown[]) => pool.transaction(async db => {
        await setTenantContext(db, tenantId);
        const authority = await db.get("SELECT k.kid FROM api_keys k JOIN tenants t ON t.id=k.tenant_id WHERE k.kid=$1 AND k.tenant_id=$2 AND t.status='active' AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now()) AND (k.scopes ? '*' OR k.scopes ? 'secrets:*' OR k.scopes @> $3::jsonb) FOR SHARE OF k,t", [kid, tenantId,JSON.stringify(scopes)]);
        if (!authority) throw new Error("Tenant authority is no longer active");
        return Reflect.apply(method,new CloudSecretsStore(db),args);
      });
    },
  });
}

/** Startup-only baseline maintenance; each tenant gets its own transaction and RLS context. */
export async function backfillTenantVersions(pool: PoolQueryClient): Promise<number> {
  await assertTenantSecurity(pool);
  const tenants=await pool.many<{id:string}>("SELECT id FROM tenants WHERE status='active' ORDER BY id");
  let count=0;
  for(const tenant of tenants) count+=await pool.transaction(async db=>{
    await setTenantContext(db,tenant.id);
    if(!await db.get("SELECT id FROM tenants WHERE id=$1 AND status='active' FOR SHARE",[tenant.id]))return 0;
    return new CloudSecretsStore(db).runVersionBackfill();
  });
  return count;
}
