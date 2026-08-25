export const meta = {
  name: 'host-env-fix',
  description: 'Fix the secrets Chrome extension native host env resolution (measured on station03): host.cjs shebang #!/usr/bin/env node fails under Chrome/launchd PATH (rc=127) and it spawns "secrets" via PATH — install-host.sh must write an absolute node shebang + embed the resolved secrets binary path at install; regression = host launches under env -i; PR-first',
  phases: [
    { title: 'Fix', detail: 'smallest owned repair: install-host.sh rewrites shebang to absolute node + embeds absolute secrets path; regression test first' },
    { title: 'Verify', detail: 'env -i launch of the host + protocol smoke under the installed config; two-sided' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Report', detail: 'PR + station03 re-registration handoff' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const EXT = MONOREPO + '/apps/secrets/extension/native-host'

const CONST = `
You are a lane of the host-env-fix workflow (2026-08-19). MEASURED (station03 investigation, 2026-08-19): the Secrets Vault extension's native host ${EXT}/host.cjs launches fine under the user's shell PATH but FAILS exactly as Chrome would launch it — shebang '#!/usr/bin/env node' + 'secrets' spawned via PATH, and launchd's PATH (inherited by Chrome) has neither node nor secrets (measured rc=127, 'env: node: No such file or directory'; launchctl getenv PATH empty on station03; node/secrets live only at /Users/hasna/.bun/bin). The extension is otherwise correct (pinned key, host registration present and pointing at an existing executable host; protocol smoke passed under full PATH with authenticated:true). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/host-env-fix-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: host-env-fix-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check open PRs touching apps/secrets/extension for an existing env-resolution fix; if one exists, verify and record — do not duplicate.
- TDD FIRST: write the failing regression (the host launched under an EMPTY environment — env -i with only the installed config — must start and answer the wire protocol) — watch it fail — then the smallest owned repair: install-host.sh (the script the user runs) writes the host's registration AND materializes an absolute node shebang (rewrite the host.cjs first line to the resolved node binary path at install time, or install a wrapper with an absolute shebang) AND embeds the absolute resolved 'secrets' binary path into the host's config (the host currently spawns 'secrets' via PATH — it must use the installed absolute path or a config value written at install). Keep host.cjs dependency-free.
- The installed copy on a machine must then work when Chrome launches it cold: env -i HOME=<user home> <node> <host> with the wire-protocol auth-status frame -> {ok:true,...}.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR, posts to #board, mementos. English. Lineage 'conversations agents register' named host-env-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: write the failing regression first, then the smallest owned repair in ${EXT} (install-host.sh + host.cjs). Run the host-protocol test suite (bounded 8 min, record counts), secrets scan, commit ('Agent: host-env-fix-<your-role>'), push, open the PR referencing the investigation (hasna/apps secrets extension, station03 evidence).
Return (JSON): { prNumber: number, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. REAL ACCEPTANCE: simulate the exact failing path — a machine with an EMPTY launchd PATH: (1) run install-host.sh into a temp home; (2) launch the installed host exactly as Chrome would: env -i HOME=<temp> <installed-node-shebang-path> <installed-host> with the wire-protocol auth-status frame; (3) require {ok:true,...} response. Also the negative control: WITHOUT the install (the raw repo host.cjs under env -i) must still fail rc=127 (proving the fix is the install, not ambient state). Paste literal output lines both ways.
Return (JSON): { installedLaunchOk: bool, rawLaunchStillFails: bool, protocolResponse: string, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) regression failed before the fix (TDD proven), (b) the repair is the smallest owned change (install-time materialization of node+secrets resolution; host stays dependency-free), (c) the verify ran the EXACT failing path (env -i, installed config) with both sides pasted, (d) PR-first, no direct pushes, secrets clean. Post '[REVIEW] <GO|NO_GO> — host-env-fix @ <evidence> — lens: native host env resolution, reviewer host-env-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: merge the PR (base-movement gate, squash with 'Agent: host-env-fix-ship' trailer), comment the merge, post to #board: the host-env fix is merged; station03 re-registration (re-run install-host.sh after syncing the checkout past the merge) + owner Chrome steps (remove stale v1 loads, Load unpacked from the SecretsVault v2 folder, full Chrome relaunch). If NO_GO or acceptance not met: comment findings + resume condition, post residue.
Return (JSON): { prNumber: number, merged: bool, mergedSha: string|null, taskState: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, regressionTest: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { installedLaunchOk: { type: 'boolean' }, rawLaunchStillFails: { type: 'boolean' }, protocolResponse: { type: 'string' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'host-env-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY, { label: 'host-env-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'host-env-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'host-env-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, verify, review, report }
