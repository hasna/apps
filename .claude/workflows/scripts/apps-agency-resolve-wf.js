export const meta = {
  name: 'apps-agency-resolve',
  description: 'Row 7ffcffe7 (owner directive 2026-08-20 drain): @hasna/agency continuity risk — investigation complete (0 dependents, sourceless, partially broken bundle, redirect target of deprecated @hasna/cli). This lane: land option (b) — retire the @hasna/cli redirect with a truthful deprecation message ([PUBLISH INTENT] on git-publishing first, sanctioned secrets-exec token path), then record option (a) — source reconstruction from the published bundle — as a tracked follow-up row with the reconstruction evidence. Fable review.',
  phases: [
    { title: 'Retire', detail: 'npm deprecate @hasna/cli@0.1.0 with truthful message; intent + confirm on git-publishing' },
    { title: 'Record', detail: 'file the reconstruction follow-up row (option a) with evidence' },
    { title: 'Review', detail: 'Fable adversarial review' },
  ],
}

const CONST = `
You are the apps-agency-resolve lane (owner-authorized, row 7ffcffe7). Final text = machine-readable JSON.

Context (measured by the completed investigation, evidence on the row): @hasna/agency@0.3.1 is globally installed, sourceless (gh 404 in all 6 orgs, npm packument repository:null for 0.2.0/0.3.0/0.3.1, bundle has 0 sourcemap markers), partially broken as shipped (imports ../db/database.js which exists nowhere — structural inference), 0 dependents, 0 own data. Its deprecation message on npmjs @hasna/cli@0.1.0 (verbatim) is: "Renamed to @hasna/agency — npm install -g @hasna/agency". Ranked decision from the row: a (reconstruct source) > b (retire the redirect) > c (accept+document); (b) is a minutes-level stopgap that lands before (a). THIS LANE LANDS (b) AND RECORDS (a) — it does NOT reconstruct the source.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: search for an existing open PR/lane fixing this (gh pr list --repo hasna/apps --search 'agency' + 'cli deprecate' + '7ffcffe7') and read the row comments. If a live lane exists, verify and record; do NOT duplicate.
- LAND (b): post [PUBLISH INTENT] on git-publishing FIRST (artifact: @hasna/cli@0.1.0 deprecate — one-line reason), then run npm deprecate with the sanctioned token path: temp npmrc holding the placeholder text '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}' (mode 600, placeholder only, never a value), then 'secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm deprecate @hasna/cli@0.1.0 "<truthful message>" --userconfig <temp-npmrc>' (npm reads NO env var — the npmrc pairing is the mechanism), then delete the temp file. The new message points users at reality (the individual @hasna/* CLIs; @hasna/agency is not maintainable — no source), plain language, no invented claims. Two-sided verify: npm view @hasna/cli deprecation before (old message) and after (new message). Then [PUBLISH-CONFIRM] in-thread.
- RECORD (a): file ONE follow-up todos row in the apps project (3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8) titled 'RECONSTRUCT: @hasna/agency source from the published bundle (option a)' with the reconstruction evidence: tarball fileCount 2 / unpackedSize 221710 B / shasum, bundle 6117 lines non-minified, the missing db/database.js gap (reimplement from the tail chunk SQL/MIGRATIONS strings), the embedded REGISTRY covers 45 of ~176 first-party packages (stale by design), and the un-swept surfaces (cloud/S3 backups, other stations, backup CLI store). Link the row 7ffcffe7.
- Do NOT: unpublish anything, touch @hasna/agency itself, run its mutating subcommands (sync/db/mcp/connect), or paste any live signed URL or credential value. Never print/capture/commit credential values. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR (none — no code change) and rows 7ffcffe7 + the new row, posts to #board. English. Distinguish measured vs inferred; state what you did not check.
`

const RETIRE = CONST + `
ROLE: retire lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Verify the current deprecation message (npm view @hasna/cli deprecation), post [PUBLISH INTENT] to git-publishing, run the npm deprecate with the sanctioned token path, two-sided verify (before/after message), post [PUBLISH-CONFIRM] in-thread. Do NOT run any other npm verb.
Return (JSON): { intentPosted, oldMessage, newMessage, deprecateRc, confirmPosted, evidence }
`

const RECORD = CONST + `
ROLE: record lane (Opus). File the ONE follow-up row per CONST (title 'RECONSTRUCT: @hasna/agency source from the published bundle (option a)') in the apps project with the reconstruction evidence; link row 7ffcffe7. Return (JSON): { followUpRowId, title, linked }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) [PUBLISH INTENT] before and [PUBLISH-CONFIRM] after the deprecate, in-thread, (b) the deprecate ran through the sanctioned token path (npmrc placeholder pairing, temp file deleted), (c) the new message is truthful and plain (no invented claims), (d) two-sided verify (before/after message), (e) exactly ONE follow-up row filed for option (a) with the evidence, (f) nothing was unpublished, no credential value touched. Post '[REVIEW] <GO|NO_GO> — apps-agency-resolve @ <timestamp> — lens: registry redirect retirement, reviewer apps-agency-resolve-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const RETIRE_SCHEMA = { type: 'object', properties: { intentPosted: { type: 'boolean' }, oldMessage: { type: 'string' }, newMessage: { type: 'string' }, deprecateRc: { type: 'number' }, confirmPosted: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['intentPosted', 'deprecateRc'] }
const RECORD_SCHEMA = { type: 'object', properties: { followUpRowId: { type: 'string' }, title: { type: 'string' }, linked: { type: 'boolean' } }, required: ['followUpRowId'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }

phase('Retire')
const retire = await agent(RETIRE, { label: 'agency-retire', phase: 'Retire', schema: RETIRE_SCHEMA, model: 'opus' })

phase('Record')
const record = retire && retire.deprecateRc === 0 ? await agent(RECORD, { label: 'agency-record', phase: 'Record', schema: RECORD_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = await agent(REVIEW, { label: 'agency-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

return { retire: retire && { oldMessage: retire.oldMessage, newMessage: retire.newMessage, deprecateRc: retire.deprecateRc, confirmPosted: retire.confirmPosted }, record: record && { followUpRowId: record.followUpRowId }, review: review && review.verdict }
