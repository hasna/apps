export const meta = {
  name: 'apps-ship-macos-app',
  description: 'Row 1a2ba6ad (owner directive 2026-08-20 drain): the owner\'s macOS app fix (recordings -> HasnaRecordings.app) is merged and he still cannot see it — nothing builds or ships the macOS app to his machine. This lane: diagnose the build path (run_swift empty-array abort, windowless bar-only launch), fix apps/recordings build.sh, build the .app, ship it to the owner\'s Mac, live verify, Fable review.',
  phases: [
    { title: 'Diagnose', detail: 'root-cause the macOS build path failures (measured, not inferred)' },
    { title: 'Fix', detail: 'build.sh fixes in apps/recordings, TDD where applicable, PR + CI' },
    { title: 'Ship', detail: 'build .app, ship to owner Mac, live verify (app present + launches)' },
    { title: 'Review', detail: 'Fable adversarial review' },
  ],
}

const CONST = `
You are the apps-ship-macos-app lane (owner-authorized, row 1a2ba6ad: "THE OWNER'S macOS APP FIX IS MERGED AND HE STILL CANNOT SEE IT. Nothing builds or ships the macOS app to his machine"). Final text = machine-readable JSON.

Context (measured): the recordings macOS app rename (HasnaRecordings.app) is merged; the stale-sweep comment names the outstanding work: the station04 leg, the CI build-and-sign path, the macOS-publish mechanism, sibling HC-00442. Related in-flight/known: the recordings prepublishOnly gate fix has its own open PR (row 7f97afef, live lane — do NOT touch it, it is held); Developer ID signing material provisioning is a SEPARATE row (63ce6ecc, pending) — this lane does NOT provision credentials; if signing material is missing, record the exact gap and continue with the unsigned build path.

Non-negotiable rules:
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/apps-ship-macos-app cut from origin/main. NEW BRANCH fix/macos-app-ship; PR-first; never push to main. Commits end with 'Agent: apps-ship-macos-app-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: search for an existing open PR fixing the macOS build/ship path (gh pr list --repo hasna/apps --search 'recordings build' + 'macos' + '1a2ba6ad'), and read the row 1a2ba6ad comments + the merged rename PR. If a live fix exists, verify and record; do NOT duplicate.
- Diagnose with evidence: reproduce the build failure (run the actual build command, paste the literal error), name the exact root cause (run_swift empty-array abort, windowless/bar-only launch), then fix the smallest owned change in apps/recordings (build.sh). TDD where applicable.
- Verify: package suite green (literal counts), 'bun install --frozen-lockfile' rc=0 in the worktree, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch) .changeset/macos-app-ship.md. CI green at the head sha.
- Ship: build the .app artifact; resolve the owner's Mac (read the row comments / rename PR for the machine — apple06 or the owner's named Mac; reachability probe with a positive control); ship the built artifact there (scp/rsync over tailscale; the app is an unsigned or signed build — if signing material is absent, ship the unsigned build and record the signing gap on row 63ce6ecc's comment, never fabricate signing); live verify: the app exists on the target, launches (open/launchctl check or remote process check), version matches the build.
- No secrets: never print/capture/commit credential values. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row 1a2ba6ad, posts to #board. English. Distinguish measured vs inferred; state what you did not check.
`

const DIAGNOSE = CONST + `
ROLE: diagnose (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the build failure with the real command (build.sh for the macOS app in apps/recordings — run_swift empty-array abort, windowless bar-only launch), paste the literal error output, name the exact root cause and the smallest owned fix. Resolve the owner's Mac target from the row comments / rename PR. Return (JSON): { rootCause, smallestFix, targetMac, buildCmd, literalError, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). Apply the smallest owned fix (from the diagnose result) in apps/recordings; failing regression test first where testable (red, measured); suite green (literal counts); frozen install rc=0; secrets scan clean; changeset patch; commit ('Agent: apps-ship-macos-app-fix'); push; open the PR referencing row 1a2ba6ad. Return (JSON): { prNumber, diffSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean, evidence }
`

const SHIP = CONST + `
ROLE: ship lane (Opus). If the fix PR is open: build the .app artifact (real build command, literal output), probe the owner's Mac (positive control; tailscale), ship the artifact there, live verify (app present, launches, version matches). If signing material is missing: ship the unsigned build and comment the exact gap on row 63ce6ecc — never fabricate signing. Do NOT merge the PR in this phase. Return (JSON): { built, artifactPath, targetMac, reachable, shipped, liveTest: {present, launches, version}, signingGap, residue: [] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR (number in the fix result) + the ship evidence: (a) root cause evidence-backed, (b) smallest owned change, (c) the build actually runs, (d) the app reached the owner's Mac and launches (live evidence, not inference), (e) signing gap recorded honestly (never fabricated), (f) CI green at the head sha, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — apps-ship-macos-app @ <sha> — lens: macOS app ship, reviewer apps-ship-macos-app-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const DIAG_SCHEMA = { type: 'object', properties: { rootCause: { type: 'string' }, smallestFix: { type: 'string' }, targetMac: { type: 'string' }, buildCmd: { type: 'string' }, literalError: { type: 'string' }, notChecked: { type: 'array' } }, required: ['rootCause', 'smallestFix'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const SHIP_SCHEMA = { type: 'object', properties: { built: { type: 'boolean' }, artifactPath: { type: 'string' }, targetMac: { type: 'string' }, reachable: { type: 'boolean' }, shipped: { type: 'boolean' }, liveTest: { type: 'object' }, signingGap: { type: 'string' }, residue: { type: 'array' } }, required: ['built'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }

phase('Diagnose')
const diag = await agent(DIAGNOSE, { label: 'macos-app-diagnose', phase: 'Diagnose', schema: DIAG_SCHEMA, model: 'opus' })

phase('Fix')
const fix = diag ? await agent(FIX, { label: 'macos-app-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Ship')
const ship = fix && fix.prNumber ? await agent(SHIP, { label: 'macos-app-ship', phase: 'Ship', schema: SHIP_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = fix ? await agent(REVIEW, { label: 'macos-app-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }) : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix did not open a PR', detail: JSON.stringify({ diag, fix }) }] }

return { diag: diag && { rootCause: diag.rootCause, targetMac: diag.targetMac }, fix: fix && { prNumber: fix.prNumber }, ship: ship && { built: ship.built, targetMac: ship.targetMac, reachable: ship.reachable, shipped: ship.shipped, liveTest: ship.liveTest, signingGap: ship.signingGap }, review: review && review.verdict }
