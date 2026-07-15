# PostgreSQL port contract

The PostgreSQL migration is a schema and security contract for a later self-hosted adapter. PostgreSQL runtime support is not ready in this slice: there is no driver, transaction adapter, integration test against a server, or controller-key persistence implementation. SQLite/PostgreSQL runtime parity is not claimed.

The migration must run as a dedicated migrator/owner role. An application role must be separately created as `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, must not own the schema or tables, and must receive only explicit DML and sequence grants plus `EXECUTE` on `computers_current_tenant()`. Public table/function access is revoked. The application must set `computers.tenant_id` with transaction-local scope before each tenant transaction and clear it by ending that transaction. Missing or empty state resolves to no tenant, so every forced RLS policy denies access.

The runtime adapter must reject pooled connections that retain a tenant setting, must test cross-tenant reads and writes using the actual application role, and must never connect as the migrator, owner, superuser, or a role with `BYPASSRLS`. These guarantees are structural only until those live tests exist.

PostgreSQL controllers must provide a persistent external install-ticket signing-key provider. The migration intentionally has no `controller_keys` table and does not pretend SQLite file protection applies to PostgreSQL. Key retrieval, rotation, backup, and access audit belong to the deployment's secret-management boundary; plaintext key material must never be returned or logged.
