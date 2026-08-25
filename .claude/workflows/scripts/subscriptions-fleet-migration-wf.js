export const meta = {
  name: 'subscriptions-fleet-migration',
  description: 'Owner-directed deep investigation (2026-08-20, 3 lenses) found the accounts->subscriptions rename complete at source/registry/install but INCOMPLETE in the fleet: old @hasna/accounts@0.2.45 still installed with its bin on PATH (silent old code), 3 live scripts hardcode it (one runs every 4 min), 12 skills teach the accounts bin, subscriptions migrate not run, new local registry home not created. This lane: pause the warmer -> migrate the live home via the sanctioned subscriptions migrate -> update the 3 scripts + skill call sites -> uninstall the old package -> verify. Fable review at the end.',
  phases: [
    { title: 'Migrate', detail: 'ordered local migration with evidence, fails closed on destructive steps' },
    { title: 'Review', detail: 'Fable adversarial review of the migration' },
  ],
}

const CONST = `
You are the subscriptions-fleet-migration lane (owner-authorized, from the 2026-08-20 deep investigation). Final text = machine-readable JSON.

Context (measured by the investigation): @hasna/accounts@0.2.45 STILL installed globally (bin ~/.local/bin/accounts -> ~/.bun/bin/accounts), data dir ~/.hasna/accounts/ still live (accounts.json mtime 16:57Z); @hasna-internal/subscriptions@0.2.46 installed (bins subscriptions, subscriptions-mcp, subscriptions-serve, subscriptions-migrate; no accounts compat bin); the new local registry path ~/.hasna-internal/subscriptions/ does NOT exist yet; 'subscriptions migrate' moves the legacy home (inode rename) and has NOT run. Scripts to fix: ~/.hasna/bin/accounts-usage-warmer.sh (live every 4 min via cron, hardcodes ACCOUNTS_BIN=$HOME/.local/bin/accounts and ~/.hasna/accounts/cache/usage), ~/.hasna/bin/seat-liveness-pass.sh (unguarded 'accounts usage' + emits '!accounts switch-account' keystrokes), ~/.hasna/bin/accounts-credential-broker.sh. Skills with accounts-bin teaching (update call sites, same verbs): seat-revive, switch-account, accounts-switch, session-flight-check, cycle-seat, permanent-agent, headless-agents, codewith-auth-inventory, build-oss, skill-build-oss, economy-breakdown, app-open-to-internal-move (in ~/.claude/skills/<name>/SKILL.md and ~/.codewith/skills/<name>/SKILL.md where present).

Non-negotiable rules:
- NEVER print/capture/commit credential values; never read token files — this lane touches scripts and dir structure, not credentials. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- IDEMPOTENCY CHECK FIRST: search todos + open PRs for an existing accounts->subscriptions migration lane or fixer before doing anything; if one exists, verify and record it, do NOT duplicate.
- The migrate step moves a LIVE data home — it is the sanctioned 'subscriptions migrate' verb only, with its documented guards; never rm -rf the legacy home, never bypass a guard with a force flag; if the verb refuses, STOP that step and record the exact refusal.
- Sequence (each step verified before the next): (1) pause the accounts-usage-warmer cron entry (record the exact cron line removed/disabled — the warmer reads the legacy cache every 4 min); (2) update the 3 scripts to the subscriptions bin (sed for 'accounts' bin/verb references, verify with 'subscriptions --help' that each verb exists; seat-liveness-pass switch keystrokes become '!subscriptions switch-account'); (3) run 'subscriptions migrate' (or the migrate verb with its documented form) — verify it created ~/.hasna-internal/subscriptions/ and moved the home; (4) AFTER migrate + scripts verified, uninstall @hasna/accounts (bun remove -g @hasna/accounts or the documented global uninstall; verify 'command -v accounts' fails and 'subscriptions' still resolves); (5) update the 12 skills' call sites (accounts -> subscriptions, same verb surface — it is a strict superset per the investigation); (6) verify end-to-end: subscriptions bin on PATH, warmer runs against the new path (run it once), no 'accounts' on PATH, ~/.hasna-internal/subscriptions/subscriptions.json present.
- Do NOT touch: ~/.codex/AGENTS.md + ~/.config/opencode/AGENTS.md rendered homes (they are renderer-owned; the fix belongs in their render sources — record the exact refs as residue for the instruction-delivery owner), the Dockerfile header comment, the release-provenance trust pins (deliberate legacy identifiers per the investigation), the MCP version pin (separate BUG row 2d9943f4).
- Record as you go: comment the tracking row (0b71efdc sibling context; the row for this work is c82297eb-60cb-4081-9712-d23603b40b24) and post progress to #apps. English. Distinguish measured vs inferred; state what you did not check.
`

const MIGRATE = CONST + `
ROLE: execute the migration (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Execute the ordered sequence with per-step evidence (literal command output lines, rc values). Fails closed: any step that refuses (migrate guard, uninstall guard) STOPS the sequence at that point with the exact refusal recorded. Return (JSON): { steps: [{step, rc, evidence}], stoppedAt: string|null, residue: [{item, note}], notChecked: [string] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the migration result: (a) each step has literal evidence, (b) the ordering held (warmer paused BEFORE migrate, uninstall AFTER migrate+scripts), (c) no credential values touched, (d) no rm -rf or force-flag bypass, (e) the residue list is complete and honest (rendered homes + deliberate legacy identifiers NOT touched), (f) the end-state verifications actually ran (command -v accounts fails, subscriptions resolves, warmer runs against the new path). Post '[REVIEW] <GO|NO_GO> — subscriptions-fleet-migration @ <timestamp> — lens: fleet migration, reviewer subscriptions-fleet-migration-review' to #apps. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const MIGRATE_SCHEMA = { type: 'object', properties: { steps: { type: 'array' }, stoppedAt: { type: ['string', 'null'] }, residue: { type: 'array' }, notChecked: { type: 'array' } }, required: ['steps'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }

phase('Migrate')
const migrate = await agent(MIGRATE, { label: 'subscriptions-migrate', phase: 'Migrate', schema: MIGRATE_SCHEMA, model: 'opus' })

phase('Review')
const review = await agent(REVIEW, { label: 'subscriptions-migrate-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

return { migrate, review: review && review.verdict }
