# Shared project registry

The MCP `create_project`, `list_projects`, `get_project`, `update_project`, and `delete_project` tools use the authenticated API when shared credentials are configured. `todos project-panel` uses the same registry and complete paginated task reads. These paths do not create a client database. Project status, short ID, and JSON metadata are persisted and checked on returned create/update receipts.

Project registry access is restricted to the deployment's configured tenant and the existing read/write scopes. A nonempty project requires explicit `force` confirmation to delete. Deletion retains task and plan content, detaches child projects and task lists, increments affected task versions, and tombstones the project in one transaction. A conflicting detach rolls back the entire operation. CLI deregistration additionally requires every linked task to be completed or cancelled, checked again under the transaction lock. The backend does not cascade-delete task content.

Project creation, reference writes, and deletion share the existing service integrity lock. Snapshot imports order parent projects before children and linked records, reject duplicate identities and cycles, and reject project tombstones before any mutation. Snapshots containing project tombstones currently require an explicit reference-preserving deletion reconciliation; they must not be treated as a successful complete migration. Machine-local project path writes are outside this change.

The project panel refuses incomplete API pages and caps dependency hydration at 1,000 project tasks instead of presenting partial totals. A newer API is required for atomic project deletion; older-server capability failures remain explicit.

Verification includes real PostgreSQL rollback and concurrent reference tests, signed-key HTTP/MCP requests, saved-credential CLI execution with no client database, and synthetic response-integrity tests. In-memory SQL fixtures are unit tests, not PostgreSQL evidence.
