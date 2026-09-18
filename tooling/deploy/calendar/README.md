# Calendar protected promotion

`calendar-promotion.yml` dispatches `prepare`, `reconcile`, or `promote` on the
exact current `main` commit after successful push CI for that commit. Its called
workflow, `calendar-promotion-execute.yml`, uses the `production` environment
and repeats admission in that executor. Actions are commit pinned. The private
OIDC trust must bind the repository, production environment and exact reusable
workflow reference `hasna/apps/.github/workflows/calendar-promotion-execute.yml@refs/heads/main`.
The sole role input is the GitHub configuration variable `CALENDAR_DEPLOY_ROLE_ARN`.
Environment scoping alone does not assert a native GitHub reviewer gate. The
enforced approval for activation is the independently reviewed private SSM
receipt, combined with exact current-main CI and candidate artifact admission.

## Prepare a service candidate

`prepare` builds the existing Calendar service Dockerfile from the monorepo
root on native ARM64. Before configuring AWS credentials, it exercises the final
image against a disposable TLS Postgres fixture at 256 CPU units, 512 MiB and
port 8080: two migrations, readiness, an owned record, cross-tenant denial and
missing/invalid/untenanted/unknown/disabled credential controls. All fixture
credentials are synthetic; only task-owned containers and a private network
are removed. An offline version check proves the image needs no runtime
package install. Trivy must produce a complete report with no high, critical
or unknown severity findings.

The producer then reads the fixed String SSM parameter `/hasna/deploy/calendar`
and checks the account, task, stable service and running image. The service must
use direct Fargate launch or a valid strategy containing only Fargate and
Fargate Spot, with matching primary deployment configuration. Every running
task must report Fargate and, for a strategy, a provider in that strategy. A task
definition without the optional `requiresCompatibilities` declaration is accepted
only when AWS's computed `compatibilities` includes Fargate and contains known,
unique launch types. An explicit declaration must remain exactly `["FARGATE"]`.
The registration clone preserves an omitted declaration; computed metadata is
never forwarded as registration input. See the [AWS task definition contract](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_TaskDefinition.html).
It pushes a
unique `candidate-<source>-<run>-<attempt>` tag to the manifest's Calendar ECR
repository. It refuses an existing tag. A valid OCI index is resolved to exactly
one Linux ARM64 child; the child manifest digest and config digest are verified
against the local image. ECR scan completion with no high, critical or undefined
findings is also required. A metadata-only `calendar-candidate` artifact contains
one `candidate.json`, including source, run/attempt, image/config digests,
manifest configuration hash, migration 0003 hash and smoke/scanner report hashes.
The corresponding synthetic smoke metadata and public-image scanner report are
retained in `calendar-candidate-evidence`, including after downstream prepare
failures when those files exist. A failed prepare does not create an admitted
candidate receipt.

This phase does not start tasks or alter the running service. The separate
operator issuer image is a required follow-up: it must pin a reviewed published
Contracts release supporting the canonical Secrets URL and use normal
`contracts issue-key --secrets-ref --issuance-id`. This workflow does not create
an issuer image, fabricate tenant credentials or claim tenant enrollment.

## Operator activation receipt

The producer has read-only access to the fixed SSM manifest. Its initial
`activation_receipt: null` makes promotion fail closed. The operator must keep
traffic closed and stop all old runtime writers while separately reviewing and executing migration, ownership
assignment, legitimate credential issuance/readback and a direct isolated
candidate proof. Changing an API-key database tenant field does not change the
signed credential claim. The service's circuit-breaker and alarm rollback must
be disabled by a separately authorized operator. Quiescing is also operator-owned:
record the original service baseline with desired count one, scale to zero, and
wait until all old writers have stopped before database changes. The final
receipt binds that original baseline hash and the exact quiesced baseline.
Closing ingress alone does not stop background writes. Reverting to an unscoped runtime after ownership
assignment is never an automatic recovery action.

Only an independently reviewed private change and its protected SSM update may
activate the receipt. Dispatch inputs and GitHub artifacts cannot replace that
authority. `control.py` is the exact validation contract; its complete synthetic
fixture lives in `control_test.py`. Required receipt fields are:

| Field | Required binding or proof |
| --- | --- |
| `schema` | `hasna.calendar-activation.v1` |
| `recorded_at`, `max_age_seconds` | UTC `YYYY-MM-DDTHH:MM:SSZ`; operator-selected validity of 1–86400 seconds, never future-dated |
| `source_commit`, `candidate_run_id`, `candidate_receipt_sha256` | Exact successful prepare source/run and SHA256 of downloaded `candidate.json` bytes, including its newline |
| `image_digest`, `image_config_digest` | Immutable candidate ARM64 child and config digests |
| `manifest_configuration_sha256`, `migration_0003_sha256` | Exact public candidate configuration and committed tenant migration |
| `baseline` | Quiesced task definition reference, registration-input hash, service-configuration hash, immutable task image digest and desired count zero |
| `pre_quiesce_baseline_sha256`, `pre_quiesce_desired_count` | Reviewed original baseline hash and original desired count one |
| `target_desired_count`, `quiescence_proof_sha256` | Explicit restoration to one and operator proof that old writers have stopped |
| `tenant_id` | Reviewed canonical tenant, maximum 64 ASCII characters |
| `ownership` | `state: assigned`, census and assignment-proof SHA256 hashes |
| `credentials` | `state: verified`, `signed_claims_verified: true`, `current_readback_verified: true`, proof SHA256 |
| `candidate_proof` | `state: passed`, `traffic_closed: true`, synthetic task-owned record and proof SHA256 hashes, exact denial-control results |
| `automatic_rollback_allowed` | `false` |

The proof's `controls` are `owned: 200`, `missing: 401`, `invalid: 401`,
`untenanted: 403`, `unknown: 403`, `disabled: 403`, `cross_tenant: 404`.
`owned_record_sha256` covers only the synthetic task-owned proof, never customer
content. Proof hashes are commitments to the operator's reviewed evidence;
the producer does not reconstruct or invent that evidence.

The entire manifest plus receipt must fit SSM Standard's 4096 UTF-8 bytes.
Configuration hashing excludes only the top-level `activation_receipt` key.
Canonical bytes are compact JSON with recursively sorted ASCII, nonnumeric
field names, UTF-8 strings, preserved array order, no whitespace or terminal
newline, and no floats. Integers must be JavaScript-safe. Duplicate JSON keys
are rejected. Python and JavaScript agreement is tested in the standard suite.

## Reconcile and promote

`reconcile` reads and validates current task/service/image state and retains
metadata hashes, including failed or partial rollouts. Its explicit stability
flag prevents an incomplete rollout being mistaken for activation proof. It
also emits `baseline_sha256` over the full canonical baseline, while retaining
only a hash of the task reference. Record that hash in the operator's reviewed
pre-quiesce evidence. It neither creates enrollment evidence nor changes production.

`promote` accepts only the unique unexpired artifact from a successful manual
main run of this same workflow, with exact source, latest attempt and reviewed
artifact hash. Before registration and again before the service update it
rechecks current-main CI, fixed SSM authority, receipt age, full baseline,
candidate registry/config digests and ECR scan, then repeats fixed authority,
live state and receipt age after slow registry reads. The activation baseline
must have desired/running/pending counts zero, no desired-running tasks, and no
recent desired-stopped task still executing. It clones the allowlisted current
task registration input, changes only the Calendar image to the immutable child
digest, verifies registration readback and updates that service's task definition
and explicitly reviewed desired count one in a single call. Completion requires
stable running tasks on the candidate digest, the reviewed restored count,
otherwise unchanged service configuration, unchanged manifest and a still-valid receipt.

The producer cannot run migrations, start standalone tasks, enroll tenants,
read credential values, write SSM, deregister tasks or roll back. AWS mutations
have no automatic SDK retry. Registration bodies use sealed private descriptors;
raw manifest/task/secret references are not retained in public artifacts or
printed. An uncertain registration/update records the required reconciliation;
operators must inspect actual state before another dispatch. Rerunning prepare
does not overwrite an existing candidate tag, and rerunning promote does not
authorize an already-changed baseline.

Before any dispatch, private setup must supply the reviewed SSM manifest, scoped
OIDC role with the exact reusable-workflow claim and production environment
binding, ECR scan-on-push and repository
tag immutability. Activation additionally needs the separate issuer image and
operator quiescence and proof, reviewed receipt, disabled rollback, and unchanged current-main
source. Source PR tests use only inert AWS/GitHub fixtures and local Docker;
they do not establish these live prerequisites.
