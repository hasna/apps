export const meta = {
  name: 'lefthook-recurrence-fix',
  description: 'Cycle-1 remediation for the lefthook-hook-fix NO_GO P0: harden the 5 iapp-wallets worktrees whose root postinstall still runs `lefthook install` (the machine-wide clobber vector), verify bun install leaves the global hooks untouched, re-review',
  phases: [
    { title: 'Harden', detail: '5 worktrees: postinstall to the env-override form, remove live lefthook binaries' },
    { title: 'Verify', detail: 'bun install in one worktree leaves the 3 global hooks byte-identical' },
    { title: 'ReReview', detail: 'scoped re-review of the P0 + direct regressions' },
    { title: 'Report', detail: 'incident row + #board' },
  ],
}

const TASK = '5dfde05f-987e-4cb2-9222-0ccddf982479'

const CONST = `
You are a lane of the lefthook-recurrence-fix workflow (2026-08-19, incident ${TASK}, CRITICAL) — cycle-1 remediation of the lefthook-hook-fix NO_GO (wf_6713cf41-1f6). The hang itself is FIXED and verified (3 global hooks rewritten: no package-manager probe cascade, LEFTHOOK_BIN -> 'timeout 10 lefthook -h' -> repo node_modules test -f; fixtures passed, kill switch intact). The reviewer's P0: THE GENERATOR REMAINS LIVE — five hasnaxyz/iapp-wallets worktrees carry the unhardened root postinstall ('mkdir -p $HOME/.hasna/wallets 2>/dev/null || true && lefthook install', lefthook ^2.1.4, live node_modules/.bin/lefthook binaries) — with global core.hooksPath live, a 'bun install' in ANY of them regenerates the boilerplate (baked /tmp path + unbounded pnpm cascade) into the machine-wide hooks dir, re-creating the incident class. Final text = machine-readable JSON.

THE FIVE WORKTREES (re-measured by the report lane): /home/hasna/.hasna/repos/worktrees/hasnaxyz-iapp-wallets/... — names: adv-verify-nocloud, remove-hasna-cloud, remove-hasna-cloud-dep, review-pr46, task-wallets-feedback-ddl. Confirm each path exists and carries the unhardened postinstall before touching it.

THE FIX (bounded, per the report lane's required close):
1. Harden each worktree's root package.json postinstall to the MAIN-08-08 FORM: env-override 'scripts/install-repo-hooks.mjs' (which never touches the global hooksPath) or remove the 'lefthook install' segment entirely — match the hardened pattern already on main (commits 0c3557e6e8/2a8b52d6a1 in internal-apps wallets). The worktrees' package.json is at their branch state — apply the same hardening the worktree would receive on rebase/merge; do NOT edit main, do NOT open PRs for worktree-local files (worktrees are not branches of the repo root; their edits are local until rebased).
2. Remove or neutralize the live lefthook binaries in those worktrees' node_modules/.bin (a 'bun install' would otherwise re-link them) — record what was removed.
3. VERIFY (in-lane): run 'bun install' in ONE of the hardened worktrees and confirm the three global hooks (~/.config/hasna/git-hooks/no-cursor-coauthor/{pre-commit,prepare-commit-msg,pre-push}) are byte-identical before/after (sha256) and that no baked /tmp path appears.
4. ALSO scan the fleet for OTHER unhardened lefthook-install postinstalls (grep package.json across the repos/worktrees on this machine for the 'lefthook install' pattern) and harden those found, bounded to this machine's trees; record the sweep population (searched N trees, found M).

NO SECRETS, NO TRACE RUNS: LEFTHOOK_VERBOSE never set or run. Capture path: redirect to files. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named lefthook-recur-<your-role>.
`

const HARDEN = CONST + `
ROLE: harden lane. Execute per the CONST: harden the 5 worktrees' postinstall, remove live binaries, verify 'bun install' leaves the 3 global hooks byte-identical, sweep the machine's trees for other unhardened 'lefthook install' postinstalls and harden them. Record every file changed with before/after sha256 of the global hooks.
Return (JSON): { worktreesHardened: [string], binariesRemoved: [string], sweep: {searched: number, found: [string], hardened: [string]}, globalHooksUnchanged: bool, hookShas: {preCommit, prepareCommitMsg, prePush}, evidence: string }
`

const REV = CONST + `
ROLE: re-review (Fable). Scoped re-review per the bounded policy: the P0 (generator/regeneration vector) + its direct regressions ONLY. Verify: (a) no reachable 'lefthook install' path into the global hooks dir remains on this machine's trees; (b) one real 'bun install' leaves the 3 global hooks byte-identical; (c) the fixed hooks' shape unchanged (no probe cascade reintroduced); (d) the sweep population is honest (searched N, found M). Post '[REVIEW] <GO|NO_GO> — lefthook-recurrence-fix @ <evidence> — lens: recurrence P0 re-review, reviewer lefthook-recur-review (cycle 1)'. Block ONLY the P0 or its direct regressions.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO: comment ${TASK} with the full evidence (hang fixed + verified, regeneration vector closed, sweep population, fail-open P2 routed as a policy question to the hook owner), complete the task. If NO_GO: comment findings, leave in_progress. Post to #board. NOTE: the fail-open P2 (pre-commit passes through when lefthook absent — 'staged credential COMMITTED SUCCESSFULLY' measured) is a SEPARATE policy question (restore the fail-closed perl scanners from the .bak-pre-pathfix-20260727 backups vs keep fail-open) — route it as a decision on the row for the hook owner, do NOT decide it in this lane.
Return (JSON): { taskState: string, residue: [string] }
`

const HARDEN_SCHEMA = { type: 'object', properties: { worktreesHardened: { type: 'array' }, binariesRemoved: { type: 'array' }, sweep: { type: 'object' }, globalHooksUnchanged: { type: 'boolean' }, hookShas: { type: 'object' }, evidence: { type: 'string' } }, required: ['worktreesHardened', 'globalHooksUnchanged'] }
const REV_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Harden')
const harden = await agent(HARDEN, { label: 'lefthook-recur-harden', phase: 'Harden', schema: HARDEN_SCHEMA })
log(`harden: ${harden && harden.worktreesHardened ? harden.worktreesHardened.length : 0} worktrees, sweep found ${harden && harden.sweep ? harden.sweep.found.length : '?'}`)

phase('Verify')
// verify is folded into the harden lane's bun-install check per the CONST; record its result

phase('ReReview')
let rev = null
if (harden && harden.globalHooksUnchanged) {
  rev = await agent(REV, { label: 'lefthook-recur-review', phase: 'ReReview', schema: REV_SCHEMA, model: 'fable' })
} else {
  rev = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'global hooks changed by bun install — recurrence vector not closed', detail: JSON.stringify(harden) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'lefthook-recur-report', phase: 'Report', schema: REPORT_SCHEMA })

return { harden, review: rev, report }
