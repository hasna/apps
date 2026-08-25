export const meta = {
  name: 'main-install-succ',
  description: 'Successor lane (row d1df40dc) after the main-lockfile-fix lineage TERMINATED at the two-cycle cap (PR #718 @ c0de58e2f, cycle-2 NO_GO 2026-08-21). Materially NEW candidate: main-side install still fails — frozen install exits 2 at @hasna/machines prepare (TS7016 vs apps/contracts/dist, no .d.ts emitted), CI 5/5 red on main, lockfile drifted since wave #717. This lane: fix at root (contracts .d.ts emission, machines prepare, lock regen) on a NEW branch cut from CURRENT main, hard scope gate, commit hygiene, one Fable review, merge, live-verify main tip.',
  phases: [
    { title: 'Investigate', detail: 'reproduce at CURRENT main: frozen install rc, machines prepare TS7016 root cause, contracts .d.ts emission state' },
    { title: 'Fix', detail: 'root fixes (contracts .d.ts emission, machines prepare, lock regen) on a NEW branch; diff gate: contracts build config + machines prepare + bun.lock only' },
    { title: 'Verify', detail: 'frozen install rc=0 fresh + CI 5/5 at head + diff gate + hygiene gate' },
    { title: 'Review', detail: 'one Fable adversarial review (fresh lineage budget)' },
    { title: 'Land', detail: 'base gate + merge + live-verify main tip frozen install rc=0' },
  ],
}

const CONST = `
You are the main-install-succ lane (row d1df40dc; owner-authorized; the ONE successor of the terminated main-lockfile-fix lineage). Final text = machine-readable JSON.

Context (measured 2026-08-21): the prior lineage (PR #718, branch main-lockfile-fix) TERMINATED at the bounded-review two-cycle cap — cycle-2 NO_GO @ c0de58e2f: (P1) frozen install NOT rc=0 — Install exits 2 at '@hasna/machines' prepare, TS7016 declaration-file resolution errors against apps/contracts/dist (no .d.ts emitted: contracts build emits no declarations); (P1) CI 0/5 at head; (P1) 94-file non-lock-only diff (unrelated src/manifests/dist/ci.yml, bumps across 20 apps); (P1) base moved (main c658589d, fix(emails) #724); (P2) author/committer name '--global' on two commits. PR #718 stays OPEN as the terminated candidate's record — THIS LANE NEVER TOUCHES ITS BRANCH. This successor is a materially NEW candidate on a NEW branch: fix the root causes at CURRENT main.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: sync (git -C /home/hasna/workspace/repos/hasna/apps fetch origin main -q; never discard local work). Confirm CURRENT origin/main sha (gh api repos/hasna/apps/commits/heads/main --jq .sha; must be c658589d or newer). Confirm row d1df40dc is pending and NO successor lane is in flight (open PR with branch main-install-succ or an in_progress row). Reproduce BOTH at CURRENT main: (a) fresh checkout, 'bun install --frozen-lockfile' with zero node_modules — literal rc (measured class: rc=2 at @hasna/machines prepare, TS7016 vs apps/contracts/dist); (b) the contracts build — does 'bun run build' in apps/contracts emit dist/*.d.ts? If main install now passes rc=0, main recovered: record it, complete the lane with the evidence, STOP.
- NEW BRANCH, NEW PR: branch 'main-install-succ' in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/main-install-succ cut from CURRENT origin/main. NEVER a duplicate of PR #718 and never its branch. Commits end with 'Agent: main-install-succ-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com) — never a '--global' name (measured defect on the terminated lineage). /home/hasna/workspace/repos/hasna/apps is READ/context only. Never push to main.
- FIX AT THE ROOT, NARROWLY: (1) apps/contracts build emits NO .d.ts — restore declaration emission so dist/*.d.ts exists (this is what machines' prepare resolves TS7016 against; check tsconfig/outDir/exports-map wiring at source; do NOT retarget the exports-map to types/ as the terminated candidate did — dist must carry declarations); (2) @hasna/machines prepare exits 2 — fix its root cause (TS7016 resolution against contracts dist; if a script/wiring defect, fix that); (3) regenerate bun.lock at CURRENT main so the wave-717 drift resolves. HARD SCOPE GATE: the PR diff MUST be limited to contracts build config + machines prepare + bun.lock (plus any changeset for the fix) — 'git diff origin/main...HEAD --stat' must show ONLY those; any unrelated file (other apps' source, dist/bin artifacts, ci.yml, version bumps) is a self-inflicted NO_GO. Do NOT commit regenerated dist/bin artifacts of other apps.
- VERIFY: fresh-checkout 'bun install --frozen-lockfile' rc=0 at the PR head (bun 1.3.14, zero node_modules, literal output); CI per-check table 5/5 GREEN at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — no RULING D class accepted for this lane); diff gate (the --stat above is within scope); hygiene gate (git log --format='%an <%ae>' — 'Andrei Hasna <andrei@hasna.com>' on every commit, Agent trailer present); secrets scan clean.
- REVIEW (one Fable adversarial reviewer — fresh lineage, own two-cycle budget): (a) install rc=0 measured at the head (literal), (b) CI 5/5 green at the head (per-check table), (c) diff gate — ONLY contracts build config + machines prepare + bun.lock (+ changeset), (d) hygiene — canonical identity on every commit, exactly one Agent trailer, (e) mergeability vs CURRENT origin/main (merge-tree). Post '[REVIEW] <GO|NO_GO> — main-install-succ @ <sha> — lens: main-side install repair successor, reviewer main-install-succ-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: main-install-succ-land', record merged sha, then LIVE-VERIFY: fresh checkout at the merged main tip, 'bun install --frozen-lockfile' rc=0 (literal), comment the result on the PR. Complete row d1df40dc with the evidence. The blocked queue PRs (frozen-lockfile class) unwind via the pr-drain lanes after the rebases.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row d1df40dc, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce at CURRENT origin/main: (a) fresh-checkout frozen install — literal rc + the failing step (expected rc=2 at @hasna/machines prepare with TS7016 vs apps/contracts/dist); (b) contracts build — does it emit dist/*.d.ts? (c) name the exact root causes for machines prepare and the missing declarations. Return (JSON): { mainTip, installRc, installOutput, contractsDtsEmitted: bool, machinesPrepareRootCause, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the narrow root fixes (contracts .d.ts emission, machines prepare, bun.lock regen at CURRENT main) in your worktree on branch main-install-succ; HARD SCOPE GATE (see CONST); canonical commit identity ('Andrei Hasna <andrei@hasna.com>' — never a '--global' name); fresh frozen install rc=0 in the worktree; commit; push; open the PR. Return (JSON): { newHead, rootCausesFixed: [string], frozenInstallRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (literal output, bun 1.3.14, zero node_modules); CI per-check table 5/5 GREEN (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling); diff gate ('git diff origin/main...HEAD --stat' in scope: contracts build config + machines prepare + bun.lock + changeset only); hygiene gate (git log %an <%ae> all commits canonical, exactly one Agent trailer each); secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, installOutput, diffGatePass, hygienePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) install rc=0 measured (literal), (b) CI 5/5 green (per-check table; the RULING D class is NOT acceptable for this lane), (c) diff gate — only contracts build config + machines prepare + bun.lock (+ changeset), no unrelated files, (d) hygiene — canonical identity on every commit, exactly one Agent trailer, (e) mergeability vs CURRENT origin/main (merge-tree clean), (f) secrets clean. Post '[REVIEW] <GO|NO_GO> — main-install-succ @ <sha> — lens: main-side install repair successor, reviewer main-install-succ-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: main-install-succ-land', record merged sha, LIVE-VERIFY: fresh checkout at merged main tip, 'bun install --frozen-lockfile' rc=0 (literal), comment on the PR, complete row d1df40dc with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveVerifyRc, liveVerifyOutput, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, installRc: { type: 'number' }, installOutput: { type: 'string' }, contractsDtsEmitted: { type: 'boolean' }, machinesPrepareRootCause: { type: 'string' }, notChecked: { type: 'array' } }, required: ['mainTip', 'installRc', 'contractsDtsEmitted'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCausesFixed: { type: 'array' }, frozenInstallRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, installOutput: { type: 'string' }, diffGatePass: { type: 'boolean' }, hygienePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks', 'installRc'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveVerifyRc: { type: ['number', 'null'] }, liveVerifyOutput: { type: 'string' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'main-install-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.installRc !== 0 ? await agent(FIX, { label: 'main-install-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'main-install-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'main-install-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or main already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'main-install-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveVerifyRc: null, liveVerifyOutput: '', rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (successor two-cycle budget)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, installRc: investigate.installRc, contractsDtsEmitted: investigate.contractsDtsEmitted }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, diffStatSummary: fix.diffStatSummary }, verify: verify && { ciGreen: verify.ciGreen, installRc: verify.installRc, diffGatePass: verify.diffGatePass, hygienePass: verify.hygienePass }, review: review && review.verdict, land }
