# Emails compatible search promotion

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
4. Dispatch `phase=promote` with that run id and file SHA256. Both gate and
   protected job verify the successful preparation's source/path/event and
   digest. The job reconstructs and verifies the immutable image, re-reads the
   current complete task and service, and compares them to the reviewed plan.
   One new task revision is registered and fully read back before one service
   update. Only metadata receipts are retained. Actual running healthy tasks
   must all use the exact new revision/image; independent normal API search
   acceptance remains a separate live proof.
5. Any uncertain mutation stops. Inspect the retained intent/registration/update
   receipts and actual AWS state before deciding whether another action is
   needed. The code never blindly retries or automatically rolls back.
   `phase=rollback`, using the same reviewed preparation, is a separate protected
   operation. It refuses unless the currently selected task is the exact planned
   candidate and the old revision is unchanged. It repoints only to that captured
   previous revision, verifies stability, and registers/deregisters nothing.

A newer main commit makes an old prepare/promote/rollback dispatch fail closed.
If main advances during a rollout that needs recovery, prepare a freshly reviewed
recovery source/plan; do not disable the exact-main gate or replay a stale job.
ECS has no atomic compare-and-swap for UpdateService. Fresh checks plus the
exclusive operator window reduce races; they do not claim a universal CAS.

This lane grants or invokes no RunTask, database migration, customer-email send,
secret-value read/write, task deregistration or role-authority mutation. Those
operations are outside this promotion.
