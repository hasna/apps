export const meta = {
  name: 'contracts-mode-surface',
  description: 'Fix lane for row 0731ef62 (CI publish-guard: member prepack builds broken vs @hasna/contracts 0.13.1 surface — sessions imports @hasna/contracts/mode (subpath removed), connectors build exit 127, access et al.; pack dry-run red at any head once install passes). Lane: IDEMPOTENCY CHECK FIRST -> reproduce the pack failure at CURRENT main -> enumerate every member importing @hasna/contracts/mode -> root fix: migrate members OFF the removed subpath (the ./mode removal is the modes-removal directive in force; do NOT restore the export) -> publish-guard pack green -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce the publish-guard pack failure at CURRENT main; enumerate all members importing @hasna/contracts/mode (grep the monorepo)' },
    { title: 'Fix', detail: 'migrate each affected member off @hasna/contracts/mode to the current contracts surface; changesets; never touch apps/contracts exports map' },
    { title: 'Verify', detail: 'publish-guard pack dry-run green at head for every affected member, frozen install rc=0, CI per-check green, diff gate (member import sites + changesets only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 0731ef62 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '0731ef62'

const CONST = `
You are the contracts-mode-surface lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21): CI publish-guard is red at any head once install passes — member prepack builds break against the @hasna/contracts 0.13.1 surface. apps/sessions imports '@hasna/contracts/mode', a subpath the 0.13.1 exports map no longer provides; connectors build exits 127; access and other members are affected. The ./mode subpath removal is the fleet's OWN modes-removal directive (owner directive 2026-07-29: no mode vocabulary, no deploymentMode(s), the modes concept was removed) — the removal is correct policy, and the defect is members still importing the removed subpath.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row); check for an existing open PR fixing the mode-subpath imports (gh pr list --repo hasna/apps --search 'contracts/mode in:title,body' and 'contracts mode subpath' — the open modes-removal PRs 410/415/421/426/405/562/563 are OLD kit-0.11-era removals, not this surface break; do not confuse or touch them). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: in your worktree with a clean frozen install, run the publish-guard pack check for a named affected member (the verb the CI publish-guard job runs — e.g. 'bun run pack' or the pack dry-run step for apps/sessions) — literal rc + the module-resolution error. Then enumerate EVERY member importing '@hasna/contracts/mode' (grep -rn 'contracts/mode' apps/ --include package.json --include '*.ts' --include '*.tsx' + the root; also surface members whose pack fails for OTHER contracts-0.13.1 surface reasons and name them separately). If the pack already passes at current main, record the evidence and STOP (the lane is complete by recovery). NOTE: main CI may be red at the Install step (frozen-lockfile class, tracked by row 3b2a7f1e's lane); your reproduction must isolate the pack failure from the Install failure — run the pack directly after a successful frozen install in your worktree.
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/contracts-mode-surface cut from CURRENT origin/main. NEW BRANCH fix/contracts-mode-surface. PR-first; never push to main. Commits end with 'Agent: contracts-mode-surface-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: migrate every member importing '@hasna/contracts/mode' to the current contracts surface (read the 0.13.1 exports map in apps/contracts/package.json to name the correct import — likely '@hasna/contracts' root or the client seam the member already uses elsewhere; match the member's own existing usage pattern). DO NOT restore the ./mode export in apps/contracts — the removal is the modes directive in force. For members whose pack fails for OTHER 0.13.1 surface reasons (e.g. connectors exit 127), diagnose each and fix at its root within the same narrow scope. Add one .changeset per affected member (or a single changeset listing them — use the repo's convention). HARD SCOPE GATE: the PR diff MUST be limited to the affected members' import sites + their changesets — apps/contracts files and any unrelated app file are a self-inflicted NO_GO.
- VERIFY: publish-guard pack dry-run (or the CI job's pack verb) PASSES at the head for EVERY member named in investigate (literal rc + output per member); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — publish-guard MUST be green; if the head's Install is green because the lockfile class resolved, all checks green required); diff gate (affected members + changesets only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean); grep proof that zero '@hasna/contracts/mode' imports remain in apps/.
- REVIEW (one Fable adversarial reviewer): (a) every mode-subpath import migrated (grep proof, measured), (b) apps/contracts exports map untouched (the removal is the directive — diff gate), (c) pack dry-run green for every affected member (literal), (d) members with other 0.13.1 surface failures fixed at root within scope, (e) CI at the head green (or the exact named non-this-lane residual), (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — contracts-mode-surface @ <sha> — lens: contracts 0.13.1 surface migration, reviewer contracts-mode-surface-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: contracts-mode-surface-land', record the merged sha, LIVE-VERIFY the publish-guard pack at the merged main tip (bounded), complete row ${ROW} with the evidence (merged sha, member list, pack rc, grep proof, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the pack failure at CURRENT origin/main (frozen install in your worktree first, then the publish-guard pack verb for a named affected member) — literal rc + the module-resolution error; enumerate EVERY member importing '@hasna/contracts/mode' (grep) + any member whose pack fails for other 0.13.1 surface reasons (name each with its error); read the 0.13.1 exports map to name the correct replacement import. Return (JSON): { mainTip, reproRc, reproOutput, membersWithModeImport: [{name, importLine, file}], otherSurfaceFailures: [{name, error}], replacementImport, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: migrate every mode-subpath import to the current contracts surface (match each member's existing usage), fix the other 0.13.1 surface failures at root within scope, add changesets; HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, membersMigrated: [string], otherFixed: [string], diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: publish-guard pack dry-run PASSES for EVERY member named in investigate (literal rc + output per member); frozen install rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; publish-guard green; all green if Install resolved); diff gate (affected members + changesets only); grep proof zero '@hasna/contracts/mode' imports remain; secrets scan clean. Return (JSON): { packResults: [{member, rc, output}], allPacksPass, frozenInstallRc, ciGreen, checks: [{name, conclusion}], diffGatePass, modeImportGrepZero, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) every mode-subpath import migrated (grep proof measured), (b) apps/contracts exports map untouched, (c) pack dry-run green for every affected member (literal), (d) other surface failures fixed at root within scope, (e) CI at the head green (or the exact named non-this-lane residual), (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — contracts-mode-surface @ <sha> — lens: contracts 0.13.1 surface migration, reviewer contracts-mode-surface-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: contracts-mode-surface-land', record merged sha, LIVE-VERIFY publish-guard pack at the merged main tip (bounded), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, livePackRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, membersWithModeImport: { type: 'array' }, otherSurfaceFailures: { type: 'array' }, replacementImport: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'membersWithModeImport', 'replacementImport'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, membersMigrated: { type: 'array' }, otherFixed: { type: 'array' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { packResults: { type: 'array' }, allPacksPass: { type: 'boolean' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, modeImportGrepZero: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['allPacksPass', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, livePackRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'contracts-mode-surface-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'contracts-mode-surface-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'contracts-mode-surface-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'contracts-mode-surface-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the surface already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'contracts-mode-surface-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, livePackRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, membersWithModeImport: investigate.membersWithModeImport, replacementImport: investigate.replacementImport }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, membersMigrated: fix.membersMigrated, diffStatSummary: fix.diffStatSummary }, verify: verify && { allPacksPass: verify.allPacksPass, ciGreen: verify.ciGreen, modeImportGrepZero: verify.modeImportGrepZero }, review: review && review.verdict, land }
