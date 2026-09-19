# Emails compatible search promotion

The existing workflow also accepts the finite `recipe=delivery-headers` choice.
The default remains `search-capacity`; the current-server caller continues to
use its existing path. Both recipes share the same production environment,
concurrency and existing role, with no new authority or workflow trust path.

The delivery recipe is a compatibility patch for the exact 1.4.10 parent image.
It changes only `email-address.ts`, `service.ts` and `providers/ses.ts`: a safe
inline sender name is used when no safe configured name exists, invalid explicit
Reply-To lists refuse before a send intent, and SES receives separate mailbox
entries. Configured-name precedence and trusted RFC reply threading already
exist in the parent. Unknown historical message identities still refuse.
No package version, dependency, migration, authentication, store or task
environment change is included. The task delta is exactly the web image.

Delivery files preserve their individually measured owners and 0664 modes.
Before any image upload, the producer tests the authenticated old and patched
send route and SES MIME code with synthetic storage/provider boundaries. These
tests do not execute the full dependency image or send mail. It also compares
the actual OCI migration inputs, package resolution and loader closure before
upload, then authenticates both registry images and repeats the comparison
before emitting preparation or admitting later operations. All original image
layers, configuration and entrypoint remain intact.

Use the normal sequence below with the same recipe on every dispatch. Delivery
artifacts are named `emails-delivery-prepared`, `emails-delivery-reconciled` and
`emails-delivery-promoted`. Their schemas and purpose differ from search, and
preparation binds the producer run, exact source, recipe, image and task hashes.
Cross-purpose substitution refuses. Delivery reconciliation admits only the
exact prepared base or exact candidate, never a guessed task revision or a
descendant image. It compares two complete running-task observations around
service and public readiness reads. Schema readiness must remain compatible
with 1.4.10; rollback to the captured parent is invalid after a forward migration.
Every operation retains the existing single-write and uncertain-outcome rules.
Live provider delivery and receiver rendering remain separate authorized tests.

This lane raises the existing self-hosted Emails search admission from one to
eight concurrent requests while preserving its deployed 1.4.10 image and later
hotpatches. It is a three-file compatibility overlay, not a whole current npm
package deployment. The current public source change is separately traced in
`recipe.json`; it must be merged before preparation can authenticate to AWS.
The existing pool remains ten unless already explicitly configured with at
least nine slots. The workflow sets only `EMAILS_SEARCH_CONCURRENCY=8` and the
selected web image; it preserves every other task field and both runtime roles.
This is a finite allowance, not a claim of sustained production throughput.

The immutable base image, all compressed blobs and uncompressed layer digests,
three final preimage bytes/owners/modes, exact patch offsets, and all replacement
hashes are verified. A deterministic tar containing exactly those three regular
files becomes one additional OCI layer. Original layers and the full image
runtime configuration are preserved; only rootfs/history describe the new layer.
No image command, package manager, migration or provider operation executes.

## Normal operator sequence

1. Merge the reviewed source and its narrow existing-role authority repair.
   Successful CI must bind the exact current main commit. Existing production
   environment protection remains required; this lane never changes protection
   or repository OIDC customization.
2. Dispatch `emails-search-promotion` on main with `phase=prepare`. The protected
   reusable job rechecks current main and CI after approval. It validates the
   current stable Emails service/task, prepares and pushes only content-addressed
   ECR blobs plus a commit-specific tag, then uploads `emails-search-prepared`.
   Preparation does not register a task or change the service.
3. Independently review the artifact's `prepared.json`: exact source and recipe,
   base and candidate image digests, three replacement files, task before/after
   hashes and previous revision. Record the SHA256 of the **file bytes** and the
   successful preparation run id. Task environments/config values are never
   included in artifacts. Keep the existing service's deployment window
   exclusive; GitHub concurrency cannot lock an external operator.
4. Before any new deployment, dispatch `phase=reconcile` with that same run id
   and file SHA256. The historical preparation must be a successful main run
   whose exact source is an ancestor of the current exact-main dispatch. This
   phase is read-only: it reconstructs the reviewed image at that historical
   source, verifies task 88's immutable identity and payload by reconstructing the
   exact reviewed task-89 candidate digest, verifies task 89's payload byte-for-byte, reads the selected service
   revision and running task image digests, and emits `emails-search-reconciled`.
   If a later manually registered revision is selected, it is admitted only when
   every task field except the web image matches task 89 and that image is an exact
   one-layer descendant preserving all parent layers, rootfs history, runtime
   configuration and prior labels. The receipt records only added label names,
   never label values, task environment values or secret references. Any task,
   image, lineage, health, or mixed-rollout drift refuses instead of authorizing a
   retry or rollback. Docker may timestamp the formerly timestamp-free final parent
   history row while appending the new layer; that one normalization is accepted only
   when every original field is unchanged and the new layer timestamp follows within
   five seconds. ECS read-only DescribeTaskDefinition fields are not treated as
   immutable payload: their historical preparation hash is retained in the receipt,
   while current admission is bound through the exact prepared task-89 payload digest.
   Only Docker's RFC3339Nano subset is accepted: explicit known
   offsets, normal civil seconds and at most nine fractional digits; leap seconds
   and RFC3339's unknown `-00:00` offset are refused. The appended compressed layer is read back, decompressed and
   hashed to the appended rootfs diff ID; metadata-only history entries are refused.
   Running task ARNs, definitions, health and image digests are sampled twice around
   a final service-state read, and any change refuses without a receipt. The selected
   stable task is a pre-migration anchor only; it
   is explicitly invalid after a forward schema migration.
5. Dispatch `phase=promote` with that run id and file SHA256. Both gate and
   protected job verify the successful preparation's source/path/event and
   digest. The job reconstructs and verifies the immutable image, re-reads the
   current complete task and service, and compares them to the reviewed plan.
   One new task revision is registered and fully read back before one service
   update. Only metadata receipts are retained. Actual running healthy tasks
   must all use the exact new revision/image; independent normal API search
   acceptance remains a separate live proof.
6. Any uncertain mutation stops. Inspect the retained intent/registration/update
   receipts and actual AWS state before deciding whether another action is
   needed. The code never blindly retries or automatically rolls back.
   `phase=rollback`, using the same reviewed preparation, is a separate protected
   operation. It refuses unless the currently selected task is the exact planned
   candidate and the old revision is unchanged. It repoints only to that captured
   previous revision, verifies stability, and registers/deregisters nothing.

A newer main commit makes an old prepare/reconcile/promote/rollback dispatch fail closed.
If main advances during a rollout that needs recovery, prepare a freshly reviewed
recovery source/plan; do not disable the exact-main gate or replay a stale job.
ECS has no atomic compare-and-swap for UpdateService. Fresh checks plus the
exclusive operator window reduce races; they do not claim a universal CAS.

This lane grants or invokes no RunTask, database migration, customer-email send,
secret-value read/write, task deregistration or role-authority mutation. Those
operations are outside this promotion.

AWS JSON request bodies use a Linux anonymous memory file, capped at 8 MiB,
sealed against writes and resizing before the AWS CLI starts. The child receives
only that descriptor through `file:///proc/self/fd/`; stdin is closed and the
parent closes the descriptor on success, failure, or timeout. This avoids AWS
CLI's rejected `/dev/stdin` input without putting complete task definitions in
argv or named disk files. Linux memfd support is required; there is no disk
fallback. Memory files are not a defense against privileged process inspection
or system swapping. The existing one-attempt behavior and uncertain-write stop
remain unchanged.

Before AWS authority, controls exercise descriptor sealing, closure, bounds,
failure paths and actual AWS CLI `--generate-cli-skeleton output` parsing with
synthetic requests, no credentials and a loopback-only endpoint. These checks
do not publish an image or prove service permissions; an actual protected
preparation and its independent receipts are still required.
