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

1. Dispatch `kms_prepare` at current green main. This reads both stable services,
   their exact task definitions and running image digests, and public readiness.
   Review the metadata-only `prepared.json` artifact and its SHA-256.
2. Dispatch `kms_execute` at the same main with that run ID and hash within
   24 hours. Existing environment protection applies. Main, CI, source, reviewed
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
