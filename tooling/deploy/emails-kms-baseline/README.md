# Emails paired KMS baseline

This one-use operation preserves API revision 90 and worker revision 22 and adds
only `EMAILS_PROVIDER_KMS_KEY_ID` and `EMAILS_PROVIDER_KMS_REGION` to their exact
registerable payloads. The contract binds the independently inspected immutable
key, original task ARNs, baseline/candidate digests, and both unchanged images.
Task environments and secret references stay in memory and never enter artifacts.
The existing Emails sealed-memory AWS transport disables automatic write retries.

`emails-kms-baseline.yml` calls the existing trust-bound
`emails-search-promotion-execute.yml` in its existing `production` environment.
It uses the same production concurrency group. No trust or IAM change is made
here; the separately reviewed worker authority must already be installed.
The operator rechecks the reviewed key is enabled immediately before dispatch;
the producer role deliberately has no additional KMS metadata permission.

1. Dispatch `kms_prepare` at current main with a successful unchanged-input CI
   anchor (`ci_run_id`). This reads both stable services,
   their exact task definitions and running image digests, and public readiness.
   Review the metadata-only `prepared.json` artifact and its SHA-256.
2. Dispatch `kms_execute` at a descendant main with identical protected inputs,
   the same CI anchor, and that prepared run ID and hash within 24 hours. Existing environment protection applies. Main, CI, source, reviewed
   artifact identity, live baseline, service settings and health are rechecked.
3. An immutable GitHub intent artifact is uploaded before AWS role assumption.
   Register API and worker once, verifying each returned full payload and retaining
   its receipt before continuing. Update API, prove readiness, then update worker
   and prove the complete pair. No image, service configuration, scale, secret,
   migration, IAM, network or task-deregistration operation is performed.

API tasks must be HEALTHY and public `/ready` must remain ready at the original
version with no migration issues. The worker baseline has no application health
check. Its receipt explicitly records this limitation: acceptance proves ECS
RUNNING, stable deployment and exact image/configuration, not worker application
health. Adding a health check would exceed this two-setting change.

Every later execution refuses when any earlier intent step was attempted or
its history is unavailable. Workflow retries are refused. Upload failure, AWS
ambiguity, partial registration, unhealthy rollout or moved production stops;
never redispatch to retry. Preserve terminal custody and reconcile via read-only
ECS/CloudTrail observations. Old task definitions remain registered and the intent
records both exact rollback anchors. Automatic rollback is disabled; any rollback
must bind the reconciled actual pair and exact originals through a reviewed
protected operation. This operation does not grant a general release capability.

```sh
python3 -I -B tooling/deploy/emails-kms-baseline/test_baseline.py
```

## Source admission without unrelated-main starvation

Dispatch remains `refs/heads/main`; its source must equal `GITHUB_SHA` and the
actual checkout. Supply `ci_run_id` for one completed successful attempt-1 `ci.yml`
main/push run from this repository. Its source must already contain this amended
gate and workflow: an older CI run cannot approve changed admission code. Use the
actual merged commit's CI run, including for squash/merge PRs; PR branch CI alone
is not admission. Once this anchor succeeds, later unrelated main commits do not
require a new monorepo CI run for this narrow KMS-only operation.

The complete Emails subtree (including its package, own frozen lock, Dockerfile
and deployment policy), baseline/search/current operator subtrees, caller and
reusable workflows, CI workflow and baseline policy test/parser must have identical
Git tree/blob identities and modes at the CI anchor, prepare source, execute
source, and freshly observed current main. The fixed boundary is enumerated in
`source_admission.py`; callers cannot supply their own paths. Ancestry is required
in that order; force-push/divergence, missing or truncated Git data, dirty checkout,
changed controls/contracts/dependencies, failed CI and rerun CI fail closed.

The runtime images and dependency bytes remain fixed by the existing task/image
contracts. This job runs Python stdlib plus gh/aws; it does not install from the
root workspace lock, rebuild an image or consume sibling Apps source. The Emails
subtree includes the actual isolated image dependency lock, so changed Emails
resolved dependencies require a new successful anchor even when unrelated root
workspace lock or sibling Skills/Domains files may advance.

The v2 prepared receipt records its own source, immutable CI identity, observed
main and protected-input digest. Execution authenticates the exact reviewed
artifact/run at that prepared source, then proves the descendant relationship
and same boundary at its own checkout. It never relabels the prepared source as
the execution source. The immutable v2 intent binds both sources and the same CI
anchor. Every operation reauthenticates the anchor and current main, records its
source-admission observation, and performs all existing live pair/readiness checks
before mutation. A protected-input change during rollout stops for reconciliation;
unrelated main movement alone does not strand a partially updated pair.

All existing one-attempt, intent-before-authority, per-write receipt, no-retry,
no-automatic-rollback and live configuration/image/health boundaries remain.
