export const meta = {
  name: 'claude-home-drift',
  description: 'Lane for row eebd07a6 (INCIDENT 719392: station01 claude home instructions PLAN-FAILED rc=1 — delivery drift detected by station01-instruction-delivery; all other homes OK with counts). Lane: IDEMPOTENCY CHECK FIRST -> reproduce the probe -> classify (home content drifted vs probe defective) -> repair at the owning surface (re-render via the instructions pipeline, NEVER hand-edit renders; or route the package defect) -> verify probe rc=0 -> one Fable review -> close row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce the claude-home plan/probe failure; classify: home drifted vs probe defective; read the watchdog probe evidence (incidents 719392)' },
    { title: 'Repair', detail: 'owning-surface repair: re-render via instructions pipeline if drifted (never hand-edit renders); file+route the package defect if the probe is broken' },
    { title: 'Verify', detail: 'probe rc=0 at the repaired home; every rendered file carries the managed-render marker; counts match the other homes (ok=71-class)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Close', detail: 'comment + complete row eebd07a6 with evidence' },
  ],
}

const ROW = 'eebd07a6-70e6-4375-9842-949302131de9'

const CONST = `
You are the claude-home-drift lane (row ${ROW}; owner-authorized via the task-drain queue after incident 719392). Final text = machine-readable JSON.

Context (measured by station01-instruction-delivery, incidents 719392): the claude provider home on station01 fails its instruction-delivery plan check with PLAN-FAILED rc=1, while codewith/codex/opencode homes all measure OK (ok=71/70/1, missing=0, stale=0). Agents starting a session in the claude home may be running rules that differ from the ratified set — including this lane's own runtime surface.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and no other lane is repairing this (no in_progress row mentioning 719392 or claude-home drift; check the incidents thread 719392 for a fixer note from the owning monitor). Reproduce the watchdog's probe exactly (read incidents 719392 for the verb it ran — likely 'instructions session plan' or the delivery-drift check) and capture the literal rc + error. If the home now measures OK at current state, record the evidence and STOP (the lane is complete by recovery).
- NEVER hand-edit a rendered instruction file. Any rendered file carries 'Managed by @hasna/configs session render' (or the equivalent marker). If the home content is drifted (missing/stale vs the canonical set), repair via the owning pipeline: 'instructions session' (plan+apply) or the profile render path that produced the other homes, and verify the render readback. If the render pipeline itself fails, capture the exact failure and ROUTE the package defect: file one BUG row for the instructions pipeline (or use the existing one if it matches) and complete this lane with the routed evidence — do NOT hand-patch renders as the fix.
- If the probe itself is defective (it fails at rc=1 while the home is actually complete — e.g. a plan verb that cannot run), that is an instructions-package probe defect: file/route the bug with repro evidence and complete the lane.
- VERIFY after repair: the watchdog's probe verb exits 0 on the claude home (literal output); the rendered home contains the managed-render marker on the rendered files; the config count is in the same class as the sibling homes (ok=71-class, missing=0, stale=0); readback of a distinctive sentence from the canonical set is present.
- REVIEW (one Fable adversarial reviewer): (a) the classification is evidence-backed (home-drift vs probe-defect, measured not guessed), (b) any repair went through the owning pipeline — no hand-edited renders, (c) the probe now exits 0 with literal output, (d) if routed, the bug row exists with repro evidence. Post '[REVIEW] <GO|NO_GO> — claude-home-drift @ station01 — lens: instruction-delivery repair, reviewer claude-home-drift-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- CLOSE: comment row ${ROW} with the full evidence (classification, probe outputs, repair or route taken, verify output, review verdict), complete the row. If routed to a package bug, name the bug row id in the completion.
- No secrets: never print/capture/commit credential values. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the row and the incidents thread 719392 (reply in-thread), posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the watchdog's claude-home probe (read incidents 719392 for the exact verb; if unavailable, run the delivery-drift check the other homes passed: 'instructions session' plan or 'instructions diff' on the claude home scoped read-only) — literal rc + error. Classify: (a) HOME DRIFTED — rendered files missing/stale vs the canonical set (count missing/stale, compare vs the sibling homes' ok=71-class); (b) PROBE DEFECTIVE — the plan verb fails at rc=1 while the home is complete; (c) RECOVERED — the home now passes. Return (JSON): { reproRc, reproOutput, classification: 'home-drifted'|'probe-defective'|'recovered', missingCount, staleCount, siblingOk, notChecked: [string] }
`

const REPAIR = CONST + `
ROLE: repair lane (Opus). Per the classification: (a) home-drifted -> repair via the owning pipeline ONLY: 'instructions session' plan+apply or the profile render path; verify render readback (managed-render marker + distinctive sentence). NEVER hand-edit renders. If the pipeline fails, capture the exact failure and route it (file/update one BUG row for the instructions pipeline naming the failure + repro). (b) probe-defective -> file/route the instructions-package probe bug with repro evidence (no home mutation). (c) recovered -> record evidence, no mutation. Return (JSON): { action: 'rendered'|'routed'|'none', renderRc, renderOutput, bugRowId, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the repaired state: the watchdog's probe verb exits 0 on the claude home (literal); rendered files carry the managed-render marker; config count in the sibling class (ok=71-class, missing=0, stale=0); readback of a distinctive canonical sentence present; if routed, the bug row exists with repro. Return (JSON): { probeRc, probeOutput, markerPresent, countClass, bugRowExists, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review: (a) classification evidence-backed, (b) repair went through the owning pipeline (no hand-edited renders — verify by checking the rendered files carry the managed marker and no git/hand edit trail), (c) probe exits 0 with literal output, (d) routed case has the bug row with repro. Post '[REVIEW] <GO|NO_GO> — claude-home-drift @ station01 — lens: instruction-delivery repair, reviewer claude-home-drift-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const CLOSE = CONST + `
ROLE: close lane. Per the review: comment row ${ROW} with the full evidence and reply in-thread on incidents 719392 with the outcome; if GO, complete row ${ROW}; if NO_GO, leave pending with findings + resume condition. Return (JSON): { rowState, threadReplyId, bugRowId, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { reproRc: { type: 'number' }, reproOutput: { type: 'string' }, classification: { type: 'string' }, missingCount: { type: 'number' }, staleCount: { type: 'number' }, siblingOk: { type: 'number' }, notChecked: { type: 'array' } }, required: ['reproRc', 'classification'] }
const REPAIR_SCHEMA = { type: 'object', properties: { action: { type: 'string' }, renderRc: { type: ['number', 'null'] }, renderOutput: { type: 'string' }, bugRowId: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['action'] }
const VERIFY_SCHEMA = { type: 'object', properties: { probeRc: { type: 'number' }, probeOutput: { type: 'string' }, markerPresent: { type: 'boolean' }, countClass: { type: 'string' }, bugRowExists: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['probeRc'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const CLOSE_SCHEMA = { type: 'object', properties: { rowState: { type: 'string' }, threadReplyId: { type: ['string', 'null'] }, bugRowId: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['rowState'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'claude-home-drift-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Repair')
const repair = investigate && investigate.classification !== 'recovered' ? await agent(REPAIR, { label: 'claude-home-drift-repair', phase: 'Repair', schema: REPAIR_SCHEMA, model: 'opus' }) : { action: 'none', renderRc: null, renderOutput: 'recovered at investigate — no mutation', bugRowId: null, evidence: 'recovered' }

phase('Verify')
const verify = repair ? await agent(VERIFY, { label: 'claude-home-drift-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'claude-home-drift-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/repair/verify did not complete', detail: JSON.stringify({ investigate, repair, verify }) }] }

phase('Close')
const close = review && review.verdict === 'GO'
  ? await agent(CLOSE, { label: 'claude-home-drift-close', phase: 'Close', schema: CLOSE_SCHEMA })
  : { rowState: 'pending', threadReplyId: null, bugRowId: null, residue: ['NO_GO — repair lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { classification: investigate.classification, reproRc: investigate.reproRc, missingCount: investigate.missingCount, staleCount: investigate.staleCount }, repair: repair && { action: repair.action, bugRowId: repair.bugRowId }, verify: verify && { probeRc: verify.probeRc, markerPresent: verify.markerPresent }, review: review && review.verdict, close }
