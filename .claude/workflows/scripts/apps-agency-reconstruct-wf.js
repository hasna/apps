export const meta = {
  name: 'apps-agency-reconstruct',
  description: 'Row 91a7b09d (option a of the agency continuity resolution): reconstruct @hasna/agency source from the published bundle — the only branch ending in a serviceable artifact. Investigation evidence (on rows 7ffcffe7/91a7b09d): tarball = package.json + dist/index.js (6117 lines, non-minified bun bundle, readable identifiers, 0 sourcemap markers), missing db/database.js must be reimplemented from the tail chunk SQL/MIGRATIONS strings, embedded REGISTRY covers 45 of ~176 packages (stale by design). This lane: extract source shape, reimplement the missing db module, land as apps/agency in hasna/apps per the monorepo placement rule, parity-verify vs the installed 0.3.1, Fable review, merge, record.',
  phases: [
    { title: 'Reconstruct', detail: 'extract source from the bundle, reimplement db module, member-conformant apps/agency' },
    { title: 'Verify', detail: 'parity vs installed 0.3.1 (version/status/help) + member gates' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Land', detail: 'base gate + merge + complete row' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the apps-agency-reconstruct lane (owner-authorized, row 91a7b09d — option (a) of the agency continuity resolution: reconstruct @hasna/agency source from the published bundle). Final text = machine-readable JSON.

Context (measured by the completed investigation, evidence on rows 7ffcffe7 + 91a7b09d): @hasna/agency@0.3.1 is the published artifact (Apache-2.0, "Unified management CLI for all 45 @hasna/* open-source packages"). The tarball is exactly package.json + dist/index.js (221,075 B, 6,117 lines, non-minified bun-build output with readable identifiers, 0 sourcemap markers; commander vendored; imports only node builtins + chalk/zod/@hasna/cloud/@modelcontextprotocol/sdk — all resolvable). The bundle imports ../db/database.js and ./db/database.js (tail chunk: cloud-feedback MIGRATIONS, SqliteAdapter, getDatabase) which exists NOWHERE in the package — the db/cloud-sync code paths throw ERR_MODULE_NOT_FOUND by construction; that module must be reimplemented from the tail chunk strings. Embedded REGISTRY covers 45 of ~176 first-party packages (stale by design — record this, do not "fix" the registry scope). The redirect is already retired (deprecate landed); the binary stays installed and works for status/help.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: search for an existing open PR/lane reconstructing agency (gh pr list --repo hasna/apps --search 'agency' + 'reconstruct' + '91a7b09d'), read rows 91a7b09d + 7ffcffe7 comments. If a live lane exists, verify and record; do NOT duplicate.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin && git -C ${MONOREPO} pull --ff-only; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/apps-agency-reconstruct cut from origin/main. NEW BRANCH feat/agency-reconstruct; PR-first; never push to main. Commits end with 'Agent: apps-agency-reconstruct-<role>' (the ONLY attribution line; never Co-Authored-By).
- PLACEMENT: per the monorepo placement rule, a public @hasna/* package lands in hasna/apps as apps/agency (kebab-case dir matching the package name, four surfaces: CLI bin, MCP bin, -serve bin, ./sdk — if the original package did not ship all four, ship what the original shipped and record the deviation honestly; name-conformance gate applies). The member-count drift gates (README/AGENTS.md member counts vs the CI gate) must be updated in the same PR.
- RECONSTRUCT: extract the source shape from the installed bundle (/home/hasna/.bun/install/global/node_modules/@hasna/agency/dist/index.js — read-only source) into a maintainable apps/agency source tree (do NOT commit the raw bundle; split into real modules where the bundle structure allows; keep the CLI verb surface IDENTICAL: status, doctor, init, update, sync, mcp, backup, db, connect, playground, logs, search, export, import, new, release). Reimplement db/database.js from the tail chunk (MIGRATIONS SQL, SqliteAdapter, getDatabase) so the db/cloud-sync paths load. Do NOT run the mutating subcommands against real data (sync/db/mcp/connect write) — verify with read-only verbs only.
- VERIFY parity vs the installed 0.3.1: agency --version == 0.3.1, agency --help surface equal, agency status enumerates the same 45-package table (read-only). Package suite green (literal counts); 'bun install --frozen-lockfile' rc=0 in the worktree; secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push; changeset (patch) .changeset/agency-reconstruct.md. CI green at the head sha.
- The version wave PR hasna/apps#670 may be open and rebasing concurrently; if the wave lands while you work, rebase your branch onto the new origin/main and re-verify (base-movement gate at merge: <merge-ref>^{tree} == <head>^{tree} at CURRENT origin/main).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and rows 91a7b09d + 7ffcffe7, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const RECONSTRUCT = CONST + `
ROLE: reconstruct lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Extract the source shape from the installed bundle into apps/agency, reimplement db/database.js from the tail chunk, land the member-conformant tree + docs updates. Do NOT commit the raw bundle. Run the read-only verbs to confirm the surface. Return (JSON): { prNumber, diffSummary, surfaceVerbs: [string], dbModuleReimplemented: boolean, registryNote, notChecked: [string] }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the PR head: parity vs installed 0.3.1 (version == 0.3.1, help surface equal, status enumerates the same 45-package table — read-only verbs only, never the mutating ones); package suite green (literal counts); frozen install rc=0; CI per-check table at the head; secrets clean; member-conformance gates pass (names + counts). Return (JSON): { parity: {version, helpEqual, statusTable}, suiteCounts: {passed, failed}, ciGreen, checks: [{name, conclusion}], secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR (number in the reconstruct result) + verify evidence: (a) the source is a genuine reconstruction (real modules, not a committed bundle), (b) db/database.js reimplemented so the db paths load (structural check — the module resolves; do NOT run mutating verbs), (c) the CLI verb surface is identical to 0.3.1, (d) parity verified with read-only verbs (version/help/status), (e) member gates pass, (f) smallest owned change, no scope creep (registry 45-of-176 staleness recorded, not "fixed"), (g) CI green at the head sha, (h) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — apps-agency-reconstruct @ <sha> — lens: source reconstruction, reviewer apps-agency-reconstruct-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate first (git merge-tree against CURRENT origin/main; after any rebase <merge-ref>^{tree} == <head>^{tree} must hold), then gh pr merge --squash --body-file ending 'Agent: apps-agency-reconstruct-land', record the merged sha, complete row 91a7b09d with the evidence. If NO_GO: comment findings + resume condition, leave open, row stays pending. Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const RECONSTRUCT_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, surfaceVerbs: { type: 'array' }, dbModuleReimplemented: { type: 'boolean' }, registryNote: { type: 'string' }, notChecked: { type: 'array' } }, required: ['prNumber', 'diffSummary', 'dbModuleReimplemented'] }
const VERIFY_SCHEMA = { type: 'object', properties: { parity: { type: 'object' }, suiteCounts: { type: 'object' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['parity', 'ciGreen'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Reconstruct')
const rec = await agent(RECONSTRUCT, { label: 'agency-reconstruct', phase: 'Reconstruct', schema: RECONSTRUCT_SCHEMA, model: 'opus' })

phase('Verify')
const verify = rec && rec.prNumber ? await agent(VERIFY, { label: 'agency-reconstruct-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'agency-reconstruct-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'reconstruct/verify did not complete', detail: JSON.stringify({ rec, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'agency-reconstruct-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — reconstruct lane must remediate per findings'] }

return { rec: rec && { prNumber: rec.prNumber, dbModuleReimplemented: rec.dbModuleReimplemented }, verify: verify && { parity: verify.parity, ciGreen: verify.ciGreen }, review: review && review.verdict, land }
