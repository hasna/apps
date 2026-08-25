export const meta = {
  name: 'remediate-webhooks',
  description: 'Remediate the webhook-delivery NO_GO P1s (task 184440f4): PR #1061 (events) TLS-hostname-verification break on undici/Node from IP-pinning; PR #1062 (conversations) hosted outbox gap for auto-unblocked dependents + action-vocabulary divergence. Same-lineage re-review per PR (cycle 1), then merge on GO. Deepseek session-model agents; Fable review.',
  phases: [
    { title: 'Remediate' },
    { title: 'ReReview' },
  ],
}

const REMEDIATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['eventsFixed', 'conversationsFixed', 'gatesRc'],
  properties: {
    eventsFixed: { type: 'boolean' },
    conversationsFixed: { type: 'boolean' },
    gatesRc: { type: 'integer' },
    newEventsHead: { type: 'string' },
    newConversationsHead: { type: 'string' },
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

phase('Remediate')
const remediate = await agent(`Remediate the two webhook-delivery NO_GO P1s (task 184440f4; both PRs at remediation cycle 1). WORKER (deepseek session model).

PR #1061 (events, branch fix-lane-events-webhook-delivery) — P1: the pin-to-validated-address scheme breaks TLS hostname verification on undici/Node. buildPinnedRequest fetches an IP-pinned URL with a Host-header override; undici verifies the certificate against the pinned IP, so a cert valid for the hostname fails ('IP: 127.0.0.1 is not in the cert's list'). Bun passes only because it skips hostname verification. THE FIX: the pin path must keep standard TLS hostname verification intact — pin at the connection level (e.g. connect to the validated IP but present the ORIGINAL hostname for TLS SNI/verification), or use a form that verifies against the hostname. Add HTTPS regression tests that assert hostname verification PASSES for a public HTTPS target (a real cert, real hostname) AND that the SSRF block still holds for private targets. Also: P2 allowlisted hostnames currently skip pinning (DNS-rebinding window stays open for them) — either pin those too or narrow the 'closes DNS-rebinding' claim; P3 redirect off-by-one + userinfo dropped on validated path — fix the redirect bound. Events suite must stay green (115/0), secrets scan rc=0, base-movement clean.

PR #1062 (conversations, branch fix-lane-conversations-webhook-delivery) — two P1s:
(a) Hosted PG path misses outbox events for auto-unblocked dependents: hosted api.ts complete → unblockDependents updates the dependent task to 'pending' but writes no outbox row (local tasks.ts does emit 'auto_unblocked'). THE FIX: the hosted unblockDependents path must write the same outbox row (auto_unblocked) in its transaction. Add an API test asserting it.
(b) Action vocabulary diverges: local emits past-tense ('started','completed','cancelled','reopened','blocked','unblocked','assigned','priority_changed'); hosted emits raw HTTP ('start','complete','cancel','block','unblock','reopen','assign','priority'). THE FIX: unify to ONE vocabulary (the past-tense one, pinned by events-bridge.test.ts) on BOTH paths. Add an API test asserting the hosted event carries the same past-tense action as local.
Also P2: API tests must assert hosted outbox emission (api.test.ts never references conversations_event_outbox); add them. P3: malformed outbox rows should dead-letter rather than sit 'pending' forever. Conversations lib+api suites must stay green (259/0 + 137/0), secrets scan rc=0, base-movement clean.

WORK per PR in its own worktree (~/.hasna/repos/worktrees/apps/<branch>), regression-first (failing test reproduces each P1, then passes), commit (Conventional + 'Agent: fix-lane-<short>' trailer), push to the PR branch. DO NOT merge/publish.

Return the schema: eventsFixed (true), conversationsFixed (true), gatesRc (0 = all gates pass), newEventsHead, newConversationsHead.`, { label: 'remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA })

phase('ReReview')
const review = await agent(`Focused re-review (FABLE) of both webhook PRs after remediation — SAME reviewer lineage, verification of the named P1 fixes only (remediation cycle 1).

PR #1061 head: ${remediate ? remediate.newEventsHead : '?'}. PR #1062 head: ${remediate ? remediate.newConversationsHead : '?'}.

Verify:
1. #1061: TLS hostname verification now PASSES on a standard undici/Node runtime for a public HTTPS target (the pin path verifies against the hostname, not the IP); HTTPS regression tests exist and pass; the SSRF default-deny still blocks private targets; the DNS-rebinding window is closed (or the claim narrowed to what holds); the redirect bound is correct. Events suite green, base-movement clean.
2. #1062: (a) hosted unblockDependents writes the auto_unblocked outbox row in its transaction — API test asserts it; (b) action vocabulary is unified to the past-tense set on BOTH local and hosted paths — API test asserts the hosted event carries the same past-tense action; (c) malformed outbox rows dead-letter. Conversations suites green, base-movement clean.
3. The remediation delta is limited to the named fixes + their tests; no unrelated surface; no secret material.
4. Base-movement gate per PR: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" clean (or only main-side files disjoint from the PR's files).

Return GO if both P1s are fixed and verified, else NO_GO with exact evidence. This is remediation cycle 1; a further NO_GO is cycle 2, and a third terminates.`, { label: 're-review', phase: 'ReReview', schema: REVIEW_SCHEMA })

return { status: review && review.verdict === 'GO' ? 'remediate-webhooks-ready' : 'remediate-webhooks-no-go', remediate, review }
