export const meta = {
  name: 'wave670-ship-r6',
  description: 'Wave #670 successor candidate — cycle-2 remediation (FINAL on this candidate): cycle-1 NO_GO at 241ba3a3 verified ALL named P1s fixed (dep pins byte-identical, verifier 1/0, lock parity 0 diffs, pglite 0.5.4, knowledge 472/0/2, contracts 0-byte, secrets clean; CI Install-fail measured ENVIRONMENTAL — @types/bun@1.4.0 absent from main\'s own lock) with ONE blocking P1: merge conflict vs CURRENT origin/main (main moved to 0d4f7491b; #702 regenerated apps/knowledge/bin/knowledge.js). This lane: rebase onto current origin/main, regenerate the knowledge committed bin/dist at the new base, re-run all gates at the new head, cycle-2 focused re-review (rebase deltas only), base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Rebase', detail: 'rebase wave onto 0d4f7491b+, regen knowledge bin/dist, push new head' },
    { title: 'Verify', detail: 'all gates at the new head (install, verifier, suites, lock parity, CI classification)' },
    { title: 'Review', detail: 'cycle-2 focused Fable re-review (rebase deltas only)' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave670-ship-r6 lane (owner-authorized — cycle-2 FINAL remediation of the wave #670 SUCCESSOR candidate; successor lineage, max two cycles on THIS candidate). Final text = machine-readable JSON.

Context (measured, review 717719): cycle-1 review at 241ba3a3 VERIFIED every named P1 fixed: projects dep pins byte-identical to main (conversations 0.5.41, todos 0.15.19, loops >=0.3.0) with nested installed-authority resolution restored; named verifier test 1 pass / 0 fail rc=0 (projects full suite 679/0); lock parity head vs origin/main = 0 resolution diffs on 1880 common keys (was 121); pglite 0.5.4 byte-identical, 0 occurrences of 0.5.5; fresh frozen install rc=0 (2508 packages), bun-types 5==5, workspace 79==79; knowledge suite 472/0/2 rc=0; versioning 9/1/1 with the single failure exactly the RULING D loops class; contracts 0-byte diff; 162-file wave diff all version/lock/changeset/generated-stamp classes; secrets scan 273,033 bytes 0 findings. CI 5/5 Install-fail measured ENVIRONMENTAL (not wave-caused): @types/bun@1.4.0 published 2026-08-20T19:46:32Z, absent from every committed lock INCLUDING main's — origin/main's own head run (32415293577 at 0d4f7491b) fails identically; main-side Fix Once, NOT fixable in wave scope without abandoning main lock parity (the exact RULING of review 717454). ONE BLOCKING P1: merge conflict vs CURRENT origin/main — main moved 4e5b6907 -> 0d4f7491b (#702 regenerated apps/knowledge/bin/knowledge.js embedding the prepack script) after the wave's rebase+regen; merge-tree rc=1 CONFLICT in apps/knowledge/bin/knowledge.js; the merge result does not exist and has not been reviewed. REVIEWER REMEDIATION (verbatim): rebase release/version-wave onto current origin/main; regenerate the knowledge committed bin/dist at the new base; re-run the gates at the new head (fresh frozen install rc=0, named verifier test 1 pass/0 fail, projects + knowledge + versioning suites, lock parity vs the new main, CI at the new head); re-review the rebase deltas only.

THIS IS CYCLE-2 — THE FINAL remediation cycle on the successor candidate. A third NO_GO terminates the successor lineage.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #670 is still OPEN and unmerged (gh pr view 670); confirm the current head is 241ba3a3 and origin/main is 0d4f7491b (re-measure if either moved); read the cycle-1 NO_GO review comment on #670 (exact text).
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave670-ship-r6 cut from origin/main. Work on the release/version-wave branch (fetch from origin); this is the existing wave PR #670 — rebase/force-push per the wave lineage, never a duplicate PR. Commits end with 'Agent: wave670-ship-r6-<role>' (the ONLY attribution line; never Co-Authored-By).
- REBASE onto current origin/main (0d4f7491b + anything newer): resolve the knowledge.js conflict per the wave lineage (regenerate the knowledge committed bin/dist AT THE NEW BASE so the version stamp carries the wave's bump AND main's content including the prepack script — both sides preserved, never drop main's fixes, never drop the wave's version stamp). KEEP all cycle-1 verified surfaces: projects dep pins (conversations 0.5.41, todos 0.15.19, loops >=0.3.0), lock parity vs the NEW main (0 wave-introduced resolution diffs), pglite 0.5.4, bun-types@1.4.0 x5 + workspace locators, contracts revert (0-byte diff vs origin/main), RULING B/C surfaces. Do NOT touch version numbers or changesets.
- VERIFY at the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); the named verifier test 1 pass / 0 fail (literal output) + projects full suite rc=0; knowledge suite rc=0 (literal counts); versioning suite with only the two documented classes (RULING D loops class acceptable); lock parity vs the NEW origin/main (0 wave-introduced resolution diffs, measured); contracts 0-byte diff; CI per-check table at the head — classify per the 717454 RULING: the Install-step lockfile-frozen failure at this head is the measured ENVIRONMENTAL @types/bun@1.4.0 class IF origin/main's own head run fails identically (controlled comparison, name the main run); 5/5 green, or green-with-RULING-D-loops-class-only, or environmental-class-with-main-identical + all non-Install checks green, or FAIL (name the failing check exactly); secrets scan clean.
- REVIEW (cycle-2 focused — FINAL on this candidate): re-review ONLY the rebase deltas + the named P1 (mergeability at CURRENT origin/main) + direct regressions; do NOT relitigate the verified surfaces unless the rebase changed them. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave successor cycle-2 rebase remediation, reviewer wave670-ship-r6-review' to #apps. Block ONLY concrete P0/P1 defects; this is the final cycle on this candidate.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r6-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count, read from the merged head's package.json files — NEVER the PR body) + merged sha — publish-all consumes it (the ONLY publisher).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #670 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase release/version-wave onto current origin/main (0d4f7491b + newer); regenerate apps/knowledge/bin/knowledge.js (and dist) at the new base keeping BOTH sides (wave version stamp + main's content incl. prepack); keep every cycle-1 verified surface (dep pins, lock parity, pglite 0.5.4, bun-types x5, workspace locators, contracts revert, RULING B/C); fresh frozen install rc=0; commit; force-push the wave branch. Return (JSON): { newHead, conflicts: [{file, resolution}], knowledgeRegen: {stamp, mainContentPreserved}, keptSurfaces: [string], frozenInstallRc, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head (sha in the rebase result): fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); named verifier test 1 pass / 0 fail (literal output); projects full suite rc=0 (counts); knowledge suite rc=0 (counts); versioning suite classes (RULING D loops class acceptable); lock parity vs NEW origin/main (0 wave-introduced resolution diffs, measured — paste the diff count); contracts 0-byte diff vs origin/main; CI per-check table at the head with the ENVIRONMENTAL classification (controlled comparison vs origin/main's own head run — name both runs and paste the Install literal); secrets scan clean. Return (JSON): { ciGreen, ciClass: 'green'|'rulingD'|'environmental-main-identical'|'fail', checks: [{name, conclusion}], installRc, verifier: {exit, passed, failed}, projectsSuite: {exit, passed, failed}, knowledgeSuite: {exit, passed, failed, skipped}, versioningClasses: [string], lockParity: {headVsMainDiffs, waveIntroduced}, contractsDiffBytes, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Cycle-2 focused re-review (FINAL on this candidate) at the new head: (a) mergeability at CURRENT origin/main (merge-tree clean, no CONFLICT), (b) the knowledge.js regen preserved both sides (wave stamp + main content incl. prepack), (c) the rebase kept every cycle-1 verified surface (dep pins, lock parity 0 wave-introduced, pglite 0.5.4, bun-types x5, workspace locators, contracts revert), (d) named verifier + projects + knowledge suites green at the head, (e) CI classified per the 717454 RULING (environmental Install class ONLY if origin/main's own head run fails identically; all non-Install checks green), (f) versioning suite only the two documented classes, (g) secrets clean. Re-review ONLY the rebase deltas + named P1 + direct regressions; do NOT relitigate verified surfaces. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave successor cycle-2 rebase remediation, reviewer wave670-ship-r6-review' to #apps. Block ONLY concrete P0/P1 defects; this is the final cycle on this candidate. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r6-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count, read from the merged head's package.json files — NEVER the PR body) + merged sha — publish-all consumes it (the ONLY publisher). If NO_GO: comment findings + resume condition, leave open (successor lineage terminates — no further cycles). Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, conflicts: { type: 'array' }, knowledgeRegen: { type: 'object' }, keptSurfaces: { type: 'array' }, frozenInstallRc: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, ciClass: { type: 'string' }, checks: { type: 'array' }, installRc: { type: 'number' }, verifier: { type: 'object' }, projectsSuite: { type: 'object' }, knowledgeSuite: { type: 'object' }, versioningClasses: { type: 'array' }, lockParity: { type: 'object' }, contractsDiffBytes: { type: 'number' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks', 'ciClass'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'wave670-r6-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = rebase && rebase.pushed ? await agent(VERIFY, { label: 'wave670-r6-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave670-r6-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave670-r6-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — successor lineage terminated (cycle cap reached)'] }

return { rebase: rebase && { newHead: rebase.newHead, knowledgeRegen: rebase.knowledgeRegen }, verify: verify && { ciGreen: verify.ciGreen, ciClass: verify.ciClass, lockParity: verify.lockParity }, review: review && review.verdict, ship }
