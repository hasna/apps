# Knowledge production deployment

The root workflow deploys only a main commit with its own successful `ci` push run.
Automatic runs refuse newer changes in Knowledge, this deployment lane, or its shared key checker;
manual runs require the exact current main tip. The production environment and the exact Knowledge deploy role are
required. Release authorization is enforced by the source/CI checks and scoped
OIDC trust; selecting the environment does not establish a reviewer gate. The scanned image is built from `git archive` and the committed package
lock, then pushed with an immutable tag and deployed by registry digest.

`knowledge_deploy` in the authoritative SSM manifest must explicitly bind the
backup bucket, authority, existing client-key reference, no-pending-migration
policy, disabled legacy owner, and short service maintenance window. An absent
contract fails before service mutation. The infrastructure source owns that
contract and the OIDC/S3 grants; this lane cannot repair its own authority.

The maintenance task runs inside ECS with the existing owner credential. It
captures a full custom-format `pg_dump` from the same exported snapshot used to
hash every non-system table and sequence, validates the archive table of
contents, uploads it to a private versioned S3 key, and hashes the exact version
on readback. Only then does it run the existing migration ledger dry-run and
no-op apply. Any pending migration is refused. All table and sequence counts and
digests must match afterwards. Database bytes and connection strings never
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
