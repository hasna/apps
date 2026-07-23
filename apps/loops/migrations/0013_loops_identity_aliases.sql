-- @generated mirror of POSTGRES_STORAGE_MIGRATIONS["0013_loops_identity_aliases"] — DO NOT EDIT.
-- Source of truth: src/lib/storage/postgres-schema.ts
-- Runner: loops-serve migrate  (checksum: sha256:01286e430aecdd1caad2ade1f3ca36abd9dd51695959333ed88253feab48a725)

GRANT USAGE, CREATE ON SCHEMA public TO open_loops_owner, open_loops_migrator;

CREATE OR REPLACE VIEW public.loops_schema_migrations AS
SELECT id, checksum, applied_at
  FROM public.open_loops_schema_migrations;
ALTER VIEW public.loops_schema_migrations OWNER TO open_loops_migrator;
REVOKE ALL ON TABLE public.loops_schema_migrations
  FROM PUBLIC, open_loops_owner, open_loops_runtime, open_loops_authenticator;
GRANT SELECT ON TABLE public.loops_schema_migrations TO open_loops_runtime;
COMMENT ON VIEW public.loops_schema_migrations IS
  'Canonical Loops migration ledger view over the released open_loops_schema_migrations checksum authority.';

CREATE OR REPLACE FUNCTION public.loops_current_tenant_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
RETURN COALESCE(
  NULLIF(pg_catalog.current_setting('loops.tenant_id', true), ''),
  NULLIF(pg_catalog.current_setting('open_loops.tenant_id', true), '')
);
ALTER FUNCTION public.loops_current_tenant_id() OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_current_tenant_id()
  FROM PUBLIC, open_loops_authenticator;
GRANT EXECUTE ON FUNCTION public.loops_current_tenant_id()
  TO open_loops_owner, open_loops_runtime;
COMMENT ON FUNCTION public.loops_current_tenant_id() IS
  'Canonical tenant context reader; the open_loops.tenant_id fallback is removed after all supported clients write loops.tenant_id.';

CREATE OR REPLACE FUNCTION public.loops_reject_runtime_tenant_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  IF pg_has_role(current_user, 'open_loops_runtime', 'USAGE') THEN
    RAISE EXCEPTION 'runtime role cannot update tenants' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.loops_reject_runtime_tenant_update() OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_reject_runtime_tenant_update()
  FROM PUBLIC, open_loops_runtime, open_loops_authenticator;
DROP TRIGGER IF EXISTS loops_reject_runtime_tenant_update ON tenants;
CREATE TRIGGER loops_reject_runtime_tenant_update
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.loops_reject_runtime_tenant_update();

CREATE OR REPLACE FUNCTION public.loops_authenticate_key(p_kid TEXT, p_token_hash TEXT)
RETURNS TABLE (
  kid TEXT, app TEXT, agent TEXT, scopes JSONB, token_hash TEXT, issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, disabled_at TIMESTAMPTZ,
  tenant_id TEXT, tenant_status TEXT, principal_id TEXT, principal_status TEXT,
  membership_status TEXT, token_kind TEXT, roles TEXT[]
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT * FROM public.open_loops_authenticate_key(p_kid, p_token_hash);
$$;
ALTER FUNCTION public.loops_authenticate_key(TEXT, TEXT) OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_authenticate_key(TEXT, TEXT)
  FROM PUBLIC, open_loops_runtime;
GRANT EXECUTE ON FUNCTION public.loops_authenticate_key(TEXT, TEXT)
  TO open_loops_authenticator;

CREATE OR REPLACE FUNCTION public.loops_append_auth_audit(
  p_id TEXT, p_kid TEXT, p_token_hash TEXT, p_request_id TEXT,
  p_operation_id TEXT, p_decision TEXT, p_deny_reason TEXT, p_metadata JSONB
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT public.open_loops_append_auth_audit(
    p_id, p_kid, p_token_hash, p_request_id,
    p_operation_id, p_decision, p_deny_reason, p_metadata
  );
$$;
ALTER FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  OWNER TO open_loops_owner;
REVOKE ALL ON FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, open_loops_runtime;
GRANT EXECUTE ON FUNCTION public.loops_append_auth_audit(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB)
  TO open_loops_authenticator;

DO $loops_identity_postconditions$
BEGIN
  IF EXISTS (
    (SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations
     EXCEPT
     SELECT id, checksum, applied_at FROM public.loops_schema_migrations)
    UNION ALL
    (SELECT id, checksum, applied_at FROM public.loops_schema_migrations
     EXCEPT
     SELECT id, checksum, applied_at FROM public.open_loops_schema_migrations)
  ) THEN
    RAISE EXCEPTION 'canonical Loops migration ledger view diverged from released checksum authority';
  END IF;
  IF to_regprocedure('public.loops_current_tenant_id()') IS NULL
     OR to_regprocedure('public.loops_authenticate_key(text,text)') IS NULL
     OR to_regprocedure('public.loops_append_auth_audit(text,text,text,text,text,text,text,jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'canonical Loops compatibility functions are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger trigger
      JOIN pg_proc proc ON proc.oid = trigger.tgfoid
     WHERE trigger.tgrelid = 'public.tenants'::regclass
       AND trigger.tgname = 'open_loops_reject_runtime_tenant_update'
       AND proc.oid = 'public.open_loops_reject_runtime_tenant_update()'::regprocedure
       AND NOT trigger.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_trigger trigger
      JOIN pg_proc proc ON proc.oid = trigger.tgfoid
     WHERE trigger.tgrelid = 'public.tenants'::regclass
       AND trigger.tgname = 'loops_reject_runtime_tenant_update'
       AND proc.oid = 'public.loops_reject_runtime_tenant_update()'::regprocedure
       AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'legacy and canonical tenant update guards must coexist';
  END IF;
END
$loops_identity_postconditions$;

REVOKE CREATE ON SCHEMA public FROM open_loops_owner, open_loops_migrator;
GRANT USAGE ON SCHEMA public TO open_loops_owner, open_loops_migrator;
