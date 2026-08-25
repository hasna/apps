export const meta = {
  name: 'lefthook-hook-fix',
  description: 'Fix the station01 machine-wide no-cursor-coauthor git hook that hangs in the pnpm lefthook -h probe cascade (3GB/process, OOM incident 5dfde05f): find and fix the regenerator, make probes non-hanging, redeploy, verify',
  phases: [
    { title: 'Fix', detail: 'locate the hook generator, fix at source, redeploy the hook' },
    { title: 'Verify', detail: 'fixture git op completes; lefthook-bearing repo still gates; no hang' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'incident row + #board' },
  ],
}

const TASK = '5dfde05f-987e-4cb2-9222-0ccddf982479'

const CONST = `
You are a lane of the lefthook-hook-fix workflow (2026-08-19, incident ${TASK}, CRITICAL). The station01 machine-wide git hook at ~/.config/hasna/git-hooks/no-cursor-coauthor/pre-commit (also prepare-commit-msg, pre-push) hangs: its call_lefthook() probe cascade reaches 'pnpm lefthook -h' (line ~47), which spawns node and never returns, pinning ~3GB per process; dozens of hung processes caused the fleet OOM incident (5dfde05f; 28 hung processes ~72GiB measured 2026-08-19; 5 PPID-1 orphans reaped). ROOT CAUSE (chief-staff 711809, source-read): the hook is REGENERATED boilerplate with a /tmp lefthook path baked in, and the path keeps changing (today: /tmp/opencode/import-iapp-wallets.wUu9H6/...; 07-30: a /tmp/claude-1000/... path — neither exists now). SOMETHING REGENERATES THIS HOOK MACHINE-WIDE. Final text = machine-readable JSON.

THE FIX (root cause, not symptom):
1. FIND THE REGENERATOR: search the owning surfaces for the hook boilerplate and the baked /tmp path pattern — ~/.hasna/configs, ~/.hasna/instructions, ~/.hasna/cloud, the hasna/apps monorepo (apps/configs, apps/instructions, apps/hooks or wherever the hook boilerplate lives), cron/loops that regenerate hooks, and any 'lefthook' installer. The generator searches for a lefthook binary (likely in a /tmp scratch dir) and bakes the found path into the hook.
2. FIX AT THE GENERATOR: (a) never bake a /tmp scratch path — resolve lefthook deterministically (PATH, or the repo's own node_modules, or a stable install location) or emit probes that cannot hang; (b) make every probe non-hanging: wrap in 'timeout 10' (or delete the package-manager probe branches that can never succeed on this box — lefthook is not on PATH, aarch64, /tmp fixtures have no node_modules — per chief-staff's remedy list); (c) keep the single-point kill switch (LEFTHOOK=0 -> exit 0) intact; (d) keep the hook's actual purpose (no-cursor-coauthor guard) working.
3. REDEPLOY: regenerate/install the fixed hook to ~/.config/hasna/git-hooks/no-cursor-coauthor/{pre-commit,prepare-commit-msg,pre-push} (only if the generator produces all three; record which files were touched, backup the old ones as .bak-<date>).
4. NO SECRETS, NO TRACE RUNS: the hook has a caller-settable LEFTHOOK_VERBOSE trace switch — never set or run it (flagged by chief-staff as a shape to note, not to exercise). Never run the hook with credentials in env. Capture path: redirect to files. Paste literal output lines.
5. RECORD: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named lefthook-fix-<your-role>. Attribution trailer 'Agent: lefthook-fix' LAST in any commit.
`

const FIX = CONST + `
ROLE: fix lane. Execute per the CONST: locate the generator (search the named surfaces; prove which surface owns the hook by finding the boilerplate source), fix the generator + the emitted hook (probes non-hanging, no /tmp paths, kill switch intact), redeploy the three hook files, backup old ones. If the generator is a repo (hasna/apps or hasna/configs), land the fix PR-first (worktree ~/.hasna/repos/worktrees/apps/lefthook-fix-<n>, PR, commit 'Agent: lefthook-fix' trailer LAST) — but the INSTALL to ~/.config/hasna/git-hooks may proceed in the same lane so Verify can test it. Record exactly which files changed.
Return (JSON): { generatorFound: bool, generatorPath: string, isGitRepo: bool, prNumber: number|null, hookFilesChanged: [string], backups: [string], probesNowBounded: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. (1) Fixture: create a throwaway git repo under /tmp, run 'git commit --allow-empty -m probe' through the INSTALLED hook — it must COMPLETE within 60s (bounded, timeout 60) and exit rc=0 (or rc=1 with the hook's own intended guard message — never a hang). (2) A repo WITH a real local lefthook (pick an existing hasna/apps checkout that has node_modules/.bin/lefthook): the hook must still run lefthook (probe finds the local binary) — verify with a bounded commit dry-run if safe, or at minimum the probe path resolution returns the local binary. (3) Confirm NO hung 'pnpm lefthook' processes appear during the fixture run (count before/after). (4) Optionally trigger a real pre-commit in one repo. Paste literal output lines.
Return (JSON): { fixtureCommitOk: bool, fixtureDurationMs: number, lefthookRepoProbeOk: bool, hungCountBefore: number, hungCountAfter: number, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the generator fix (no /tmp paths, deterministic resolution), (b) probes cannot hang (timeout or removed branches), (c) kill switch intact, (d) hook purpose preserved, (e) verify evidence real, (f) no secrets/trace runs. Post '[REVIEW] <GO|NO_GO> — lefthook-hook-fix @ <sha-or-path> — lens: hook hang fix, reviewer lefthook-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + verified: comment ${TASK} completed with the generator path, fix, redeploy + verify evidence; if NO_GO: comment findings, leave in_progress with residue. Post one line to #board.
Return (JSON): { taskState: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { generatorFound: { type: 'boolean' }, generatorPath: { type: 'string' }, isGitRepo: { type: 'boolean' }, prNumber: { type: ['number', 'null'] }, hookFilesChanged: { type: 'array' }, backups: { type: 'array' }, probesNowBounded: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['generatorFound', 'probesNowBounded'] }
const VERIFY_SCHEMA = { type: 'object', properties: { fixtureCommitOk: { type: 'boolean' }, fixtureDurationMs: { type: 'number' }, lefthookRepoProbeOk: { type: 'boolean' }, hungCountBefore: { type: 'number' }, hungCountAfter: { type: 'number' }, evidence: { type: 'string' } }, required: ['fixtureCommitOk'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'lefthook-fix-lane', phase: 'Fix', schema: FIX_SCHEMA })
log(`fix: generator=${fix && fix.generatorFound} bounded=${fix && fix.probesNowBounded} pr=${fix && fix.prNumber}`)

phase('Verify')
const verify = await agent(VERIFY, { label: 'lefthook-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
log(`verify: fixture=${verify && verify.fixtureCommitOk} lefthookRepo=${verify && verify.lefthookRepoProbeOk}`)

phase('Review')
let review = null
if (fix && fix.probesNowBounded && verify && verify.fixtureCommitOk) {
  review = await agent(REVIEW, { label: 'lefthook-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'fix or verify did not pass', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'lefthook-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, verify, review, report }
