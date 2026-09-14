# Emails compatible reply promotion

This follow-up overlays eight reviewed source files on the exact image produced
by the preceding search-capacity promotion. It preserves the existing 1.4.10
runtime, search capacity, dependency layers, startup, task roles, sidecars and
all unrelated task settings. Three pure modules must be absent before adding
them. Existing file ownership and modes remain exact; newly added files are
root-owned0644. No image command, migration or package installation runs.

The source implementation is separately maintained by the Emails producer PR
referenced in `recipe.json`. This compatible runtime adds typed parent-based
reply headers, explicit Reply-To validation and the malformed URL-boundary
check. It captures a new sent message's wire identity only after its successful
send is durable, through the exact sender instance and opaque receipt involved
in that send. Capture failures leave sent state truthful and never retry mail.
The old runtime has no scheduled-enqueue route; this overlay does not add it.

The default SES resolver cannot infer a wire Message-ID domain. The optional
`sesMessageIdDomains` recipe field is either null (preserve current configuration)
or an exact JSON environment value backed by actual received header evidence.
Each region entry names a domain, evidence SHA256 and verified-at timestamp.
The task transformation can add only this exact mapping, and refuses a conflicting
existing mapping or secret alias. It preserves `EMAILS_SEARCH_CONCURRENCY=8`.
Resend uses the provider's supported retrieval API. Historical messages never
inherit today's provider association; they require actual recorded RFC identity.

## Preparation and authority

The new caller workflow reuses `emails-search-promotion-execute.yml`, its existing
production protection and the same repository OIDC identity and IAM role. A
literal search/reply choice selects checked-in paths; there is no arbitrary
script-path input. Both callers use the same concurrency group. Existing search
recipe and admission defaults remain unchanged.

`baseReconciliation` must identify two successful prior search workflow runs and
the exact prepared.json/promoted.json file digests. The gate verifies their
source, branch, event and workflow identity, downloads the trusted artifacts,
and compares both receipts to the expected base/config/source and search recipe.
A null reconciliation refuses preparation before AWS activity. The initially
predicted base digest must be reconciled with those actual protected results
before final recipe review; a prediction alone is insufficient.

The normal sequence is:

1. Complete and independently reconcile the preceding search prepare/promote.
   Bind its run IDs and file digests in the reviewed recipe. Merge the reviewed
   producer reply source and this follow-up through normal PR checks.
2. Dispatch `emails-reply-promotion` on the exact current main with phase=prepare.
   Exact-main CI and prior search receipts are checked before AWS credentials
   and again in the protected job. The builder verifies all prior OCI layers,
   five preimages, three absences, parent directory types, exact patch context
   and output hashes. It appends one deterministic eight-file layer and pushes
   only immutable content-addressed blobs and a commit-specific reply tag.
3. Independently review `emails-reply-prepared/prepared.json` and its file digest.
   Then dispatch promote with that preparation run ID and SHA256. The unchanged
   mutation engine revalidates the full source/image/task/service, registers one
   task revision, reads it back, and performs one guarded service update.
4. A failed or uncertain write stops with durable metadata receipts. The existing
   guarded rollback repoints only to the exact captured previous task; it never
   automatically retries, resets a foreign deployment or deregisters tasks.

The service deployment window must stay exclusive across external operators:
ECS offers no atomic compare-and-swap. New main commits invalidate stale dispatch
plans. This workflow grants no IAM authority and calls no email, database or
credential mutation APIs. Authorized test-email delivery and received-header /
Gmail display confirmation remain separate live validation.
