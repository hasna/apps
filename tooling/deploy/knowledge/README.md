# Knowledge production deployment

The root workflow deploys only a main commit with its own successful `ci` push run.
Automatic runs refuse newer changes in Knowledge, this deployment lane, or its shared key checker;
manual runs require the exact current main tip. The production environment and the exact Knowledge deploy role are
required. Release authorization is enforced by the source/CI checks and scoped
OIDC trust; selecting the environment does not establish a reviewer gate. The scanned image is built from `git archive` and the committed package
lock, then pushed with an immutable tag and deployed by registry digest.

`knowledge_deploy` in the authoritative SSM manifest must explicitly bind the
backup bucket, authority, existing client-key reference, reviewed migration
policy, disabled legacy owner, and short service maintenance window. An absent
contract fails before service mutation. The infrastructure source owns that
contract and the OIDC/S3 grants; this lane cannot repair its own authority.

The maintenance task runs inside ECS with the existing owner credential. It
captures a full custom-format `pg_dump` from the same exported snapshot used to
hash every non-system table and sequence, validates the archive table of
contents, uploads it to a private versioned S3 key, and hashes the exact version
on readback. Only then does it run the existing migration ledger dry-run and
apply. The `no-pending-migrations` policy refuses every pending migration.
The `reviewed-additive-nonce-v1` policy also pins the complete SHA256 of
`reviewed-migrations.json`. It accepts only all five exact ledger additions
`knowledge_pg_132` through `knowledge_pg_136`, or an already applied set; partial
or unrelated pending sets fail before migration. It verifies the exact new empty
nonce table, function and always-enabled immutability trigger, while preserving
every existing table, function, sequence and old ledger row. The web and migration
tasks must resolve the same runtime DSN reference, and the runtime role must
already have the required schema and future-table SELECT/INSERT privileges.
The lane changes no grants. Post-migration checks verify those privileges again.
Database bytes and connection strings never
reach GitHub artifacts. Private backup objects have no automated deletion path.

Service activation retains existing task properties and removes the retired
storage selector. Legacy tenant ownership remains disabled. Success requires
the exact running image digest, public health/readiness/version, anonymous
rejection and an authenticated read through the shipped CLI with its owner-only
credential provider. The ordinary deployment key proves basic authentication;
it does **not** prove guarded tenant authorization. The separately authorized
operator must verify private review through the package-owned writer and the
approved tenant credential after deployment. A separate shared fleet check runs
in strict read-only mode after deployment; it cannot mint or rotate a key.

Rollback restores only the captured immutable old task definition and desired
count after checking service ownership, then verifies its running digest. A
launched database task without a verified terminal receipt is an unresolved
outcome: the lane deliberately leaves the service quiesced, records the failure,
and requires reconciliation of that exact ECS task/S3 receipt before recovery.
It never restores a database automatically. The phase and recovery artifacts
retain the identifiers needed to reconcile interrupted runs. ECS has no atomic
compare-and-swap service update, so these read-before-write guards also depend
on the production deployment concurrency group and avoiding out-of-band service
changes during the maintenance window.

Local safety checks: `python3 -m unittest discover -s tooling/deploy/knowledge -p
"test_*.py"`. Container build, image
scan, AWS permissions, backup readback, and production behavior require the
repository workflow; source tests alone do not establish them.
