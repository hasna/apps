export const meta = {
  name: 's3-estate-buckets',
  description: 'Owner directive + Fable verdict 2026-08-24 (task O15-00627): provision six estate S3 buckets in hasna-xyz-infra, wire skills/loops/deliverables as prefix tenants under the apps bucket, extract the shared digest-keyed sync engine from @hasna/skills, loops adopts ~/.hasna/loops/loops/<name>/ layout, live-test push/pull, retire the empty legacy skills buckets. Deepseek session-model agents; one Fable adversarial review; PR-first.',
  phases: [
    { title: 'Provision' },
    { title: 'Wire' },
    { title: 'Review' },
    { title: 'LiveTest' },
    { title: 'Retire' },
  ],
}

const PROVISION_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['buckets', 'iacPr'],
  properties: {
    buckets: { type: 'array', items: { type: 'string' } },
    iacPr: { type: 'string' },
  },
}

const WIRE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['prs'],
  properties: {
    prs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['repo', 'prNumber', 'state'],
        properties: {
          repo: { type: 'string' },
          prNumber: { type: 'integer' },
          state: { type: 'string' },
        },
      },
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

phase('Provision')
const provision = await agent(`Provision the six estate S3 buckets per the Fable verdict (task O15-00627, owner directive 2026-08-24). All in hasna-xyz-infra (789877399345):

hasna-apps-prod-store-789877399345
hasna-internalapps-prod-store-789877399345
hasna-harnesses-prod-store-789877399345
hasna-business-engines-prod-store-789877399345
hasna-infra-prod-store-789877399345
hasna-products-prod-store-789877399345

Per bucket: versioning ENABLED; a bucket-policy DENY on s3:DeleteObject for */bundles/* (append-only bundles); required tags Project/Environment/Division/ManagedBy. Do NOT provision any per-app bucket. Do NOT create the old hasna-oss-skills-prod or hasna-xyz-opensource-skills-prod.

Land via IaC PR (the shared-infra repo's terraform; task worktree, PR-first). Do NOT merge or apply to prod — the PR is the deliverable. If provisioning to prod is outside the workflow's authority, prepare the exact IaC + PR and record the apply gate as the resume condition.

Return the schema: buckets (the six created/provisioned), iacPr (the PR number or 'prepared-pending-apply' + resume condition).`, { label: 'provision', phase: 'Provision', schema: PROVISION_SCHEMA })

phase('Wire')
const wire = await agent(`Wire skills/loops/deliverables into the apps estate bucket as prefix tenants, and extract the shared sync engine (Fable verdict, task O15-00627). WORKER.

1. PR to @hasna/skills: add base-prefix config (HASNA_SKILLS_S3_PREFIX=skills/), repoint HASNA_SKILLS_S3_BUCKET to hasna-apps-prod-store-789877399345 in deployed config, and EXTRACT the ~90%-built cloud-sync engine (push/pull/cloud sync) into a shared package-owned library parameterized by (estate bucket, app prefix). Publish writes a new digest object then updates a signed index (<app>/index/<name>.json); pull resolves name->digest, fetches by digest, verifies sha256, hydrates atomically. Regression tests first; secrets scan staged rc=0.
2. PR to loops: adopt local layout ~/.hasna/loops/loops/<name>/ with prompt/ + scripts/ subdirs; wire push/pull through the shared sync library against prefix loops/. Regression tests first.
3. Prefix-scoped IAM PR: skills ECS worker gets s3:GetObject on the apps bucket /skills/bundles/* only; skills publisher write on /skills/*; loops sync read/write on /loops/*. No principal bucket-wide.
4. Commit (Conventional + 'Agent: s3-estate-<short>' trailer), push, open PRs. DO NOT merge, DO NOT publish.

Return the schema: prs (one per repo). If a step is blocked, state state:'blocked' + the exact gate.`, { label: 'wire', phase: 'Wire', schema: WIRE_SCHEMA })

phase('Review')
const review = await agent(`Adversarial review (FABLE) of the estate-bucket PRs. PRs: ${JSON.stringify(wire)}.

For EACH PR: the estate contract is honored (prefix tenants, append-only bundles, signed index, sha256 verification); no secret material (vault-lane references are references not values); regression tests fail-pre/pass-post; base-movement gate clean per PR; bounded at two remediation cycles. The shared sync engine is genuinely shared (one package-owned library), not a copy.

Return GO if all sound, else NO_GO with per-PR exact findings. [REVIEW] comment on each PR.`, { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA })

if (!review || review.verdict !== 'GO') {
  return { status: 's3-estate-buckets-no-go', provision, wire, review }
}

phase('LiveTest')
const livetest = await agent(`Live-test the estate-bucket wiring after review GO (WORKER).

1. Merge the reviewed PRs (base-movement gate per PR, gh pr merge --squash --body-file ending 'Agent: s3-estate-<short>', trailer verified).
2. Apply the IaC provision (per the provision lane's apply gate — if the gate is outside authority, record the exact resume).
3. LIVE TEST the real path: push one skill bundle and one loop from machine A, pull on machine B, verify sha256 digest match and atomic hydration; verify the worker can read skills/bundles/* and CANNOT read loops/* (negative control).
4. Fix-and-re-test until live passes; on bound exhaustion STOP and report verbatim.

Return { merged: [...], liveTest: 'pass'|'fail' + evidence }.`, { label: 'livetest', phase: 'LiveTest', schema: { type: 'object', properties: { merged: { type: 'array', items: { type: 'integer' } }, liveTest: { type: 'string' }, evidence: { type: 'string' } }, required: ['merged', 'liveTest'] } })

phase('Retire')
const retire = await agent(`After the live test passes: retire the two empty legacy skills buckets (hasna-oss-skills-prod-789877399345, hasna-xyz-opensource-skills-prod). Both are measured EMPTY — verify empty at retirement time (ListObjectsV2 count 0), then delete them + remove their IaC resources in a PR, filing the disposal record per the artefact-lifecycle rule with the verification evidence attached. NEVER delete non-empty data; if a bucket has any object, STOP and report. Post completion in-thread on announcements and the project channels; update knowledge with one canonical item hasna-s3-estate-topology (six buckets, tenant-prefix contract, bundles/index versioning); update or create the skill governing estate-bucket usage for future apps (new app = new prefix + prefix-scoped policy in its estate bucket, never a new bucket).`, { label: 'retire', phase: 'Retire' })

return { status: 's3-estate-buckets-done', provision, wire, review, livetest, retire }
