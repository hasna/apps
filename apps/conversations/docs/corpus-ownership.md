# Corpus ownership cutover

The PostgreSQL server serves one tenant per corpus. Migration 15 adds ownership metadata but does not choose an owner. Unbound deployments return 503 for readiness and authenticated corpus routes; liveness and public OpenAPI remain available. An API key cannot initialize ownership, and an untenanted key cannot read or write a bound corpus.

An administrator first applies reviewed migrations using the owner role. Then, using only the explicit `HASNA_CONVERSATIONS_DATABASE_URL_OWNER` connection, run `conversations-serve corpus inspect`. Its output contains the corpus ID, legacy registration receipt count/digest and unrecognized-identity count; it contains no messages, receipt bodies or connection string.

After reviewing the destination tenant, authority and inventory, run:

```
conversations-serve corpus adopt --corpus-id CORPUS_ID --tenant-id TENANT_ID --authority-id AUTHORITY_ID --actor OPERATOR_ID --legacy-receipt-count COUNT --legacy-receipt-digest SHA256
```

The command checks the actual PostgreSQL table owner, locks the inventory, verifies the supplied proof, and inserts an immutable adoption receipt and legacy mappings in one transaction. An identical retry returns the same receipt. Another owner or changed inventory is refused. Runtime grants do not permit initialization or mutation; triggers also reject truncation. This operation is never run automatically during server startup or migration.

Deployments may additionally pin all three `HASNA_CONVERSATIONS_CORPUS_ID`, `HASNA_CONVERSATIONS_TENANT_ID`, and `HASNA_CONVERSATIONS_AUTHORITY_ID` variables. If any is configured, all must be valid and match persisted ownership. These variables cannot reassign ownership. Configure the runtime role with SELECT on the binding and adoption mapping tables; keep owner credentials out of the serving process. Drain old server versions before admitting traffic to the adopted corpus: old binaries do not enforce the new boundary.

Before enabling traffic, the existing privileged credential issuance process must provision registered API keys with a signed tenant claim matching the binding. Legacy keys with no tenant are refused; this package does not add an unauthenticated key bootstrap endpoint. Owner inspection/adoption itself does not need an API key.

Every authenticated route checks the signed principal tenant before corpus access, including project registration, feedback, redaction and event drain. This is a single-corpus deployment boundary, not multi-tenant row-level storage. Separate tenant corpora need separate database/schema and role isolation.

Existing default-tenant registration receipts are not rewritten. Adoption records their exact hashes, and the new owner can request mapped historical readback using the original receipt identity. New registration capability advertises persisted ownership. A mutation for an operation/step with historical ownership evidence is refused until explicitly reconciled; it must not recreate the old target under a new tenant claim. This change does not implement a legacy inverse/reconciliation workflow. Other-tenant or other-corpus legacy records make adoption fail before writes and require a reviewed migration plan.

Outbox durability remains a separate cutover requirement. This change binds access to event drain but does not replace its filesystem sink or assert delivery. Preserve all original databases, attachment data, registration proofs and event spools until migration parity and downstream acknowledgement have been verified.

Synthetic acceptance covers real PostgreSQL owner/runtime roles, signed registered keys, wrong/null tenant rejection, readiness/deployment mismatch, restart readback, immutable history, historical lookup, refusal of duplicate legacy operations, and rollback after a mapping write failure. No live adoption is performed by tests.
