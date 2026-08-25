export const meta = {
  name: 'session-injection-skill',
  description: 'Author + install the generalized session-injection monitor skill (task 63569d2f): a declarative+scripted skill that injects a turn into a coding-agent session when a watched source has new content — opencode2 (v2.session.prompt, the measured baseline) + opencode classic, Claude Code, Codewith, Codex; sources: conversations/emails/todos/knowledge/any cursor-gated CLI',
  phases: [
    { title: 'Author', detail: 'create-skill standard: dedupe search across all homes first, then author SKILL.md + script with per-runtime adaptation and an honest capability matrix' },
    { title: 'Verify', detail: 'two-sided positive control per runtime surface (fires on known-new content, stays silent on known-empty), opencode2 v2.session.prompt exercised live' },
    { title: 'Review', detail: 'Fable adversarial review (honesty matrix, no fake cross-runtime parity claims)' },
    { title: 'Install', detail: 'register via hasna/skills, install into all coding-agent skill homes, verify presence per home' },
    { title: 'Report', detail: 'task 63569d2f + #board + mementos' },
  ],
}

const TASK = '63569d2f-fd8c-4afa-bde3-afb991999452'
const HOMES = ['~/.config/opencode/skills', '~/.claude/skills', '~/.codex/skills', '~/.codewith/skills']

const CONST = `
You are a lane of the session-injection-skill workflow (2026-08-19, task ${TASK}, HIGH). Author a generalized session-injection monitor skill: 'a session monitor that injects a turn when a source has new content', generalized across opencode2 (v2.session.prompt API — the MEASURED baseline, proven 2026-08-19), opencode classic, Claude Code, Codewith, Codex. Sources generalize: conversations, emails, todos, knowledge, any cursor-gated CLI. Procedure per the task: sub-agent authoring per the create-skill standard, adversarial review, register via hasna/skills, install into all coding-agent skill homes (opencode primary, claude, codex, codewith). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- IDEMPOTENCY CHECK FIRST: before authoring anything, search the skill corpus in EVERY home (${HOMES.join(', ')}) and the skills CLI registry for an existing skill that covers inject-a-turn monitoring (candidates seen: inbox-monitor, monitor, monitor-fleet, monitor-manifest, coordination-store-monitors, sandbox-context-injection — none is the inject-a-turn class, but PROVE that per home with a positive control: the search finds a known-present skill). If a skill already exists, extend it — do not create a rival.
- HONESTY MATRIX (P1-class): per runtime, the skill states its REAL injection mechanism. opencode2 v2.session.prompt is the measured baseline (a runtime-owned prompt API — a trigger it arms wakes its own session). Claude Code has NO equivalent native turn-injection API — the skill must document the honest Claude mechanism (a runtime-owned monitor whose events are DELIVERED into a turn, per the inbox pattern) and MUST NOT claim v2.session.prompt parity it does not have. Same for Codewith/Codex/opencode classic: name the mechanism or say 'no native injection surface; the skill's script falls back to a durable cursor/queue the next turn reads'. A skill that invents parity fails review.
- Author per the create-skill standard: SKILL.md with proper frontmatter (name bare, hyphens; description one line; user_invocable only in Claude homes), one folder per skill name, no subdirectories, per-tool adaptation (no Claude-only tools in Codex/OpenCode copies), English.
- The script is a real gate loop: poll the configured source (conversations digest / emails inbox / todos / knowledge — the 'any cursor-gated CLI' generalization means the cursor file defines WHICH CLI + WHICH verb), seed the cursor at arm time, emit ONE event line per new item (no raw payloads, no secrets), and when the runtime has an injection surface, inject a turn; otherwise write the cursor/queue the next turn reads. Fail-closed: a poll failure is reported, never read as quiet. No secrets in any surface.
- No secrets: never print/capture/commit credential values; the cursor/queue holds IDs only. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board, mementos. English. Lineage 'conversations agents register' named session-inject-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const AUTHOR = CONST + `
ROLE: author lane. Per the CONST (dedupe FIRST — prove the corpus search per home with a positive control), author the skill 'session-inject-monitor': SKILL.md (bare name, one-line description, per-home frontmatter adapted) + the gate script (poll → cursor → one line per event → inject or queue). Homes to write: ${HOMES.join(', ')} (create the skill dir in each; adapt the SKILL.md per home — strip user_invocable outside Claude, name the runtime's own mechanism in each copy). Include the HONESTY MATRIX section in the main SKILL.md: per runtime, the measured injection surface (opencode2 v2.session.prompt — cite the baseline) or the honest fallback (cursor/queue read by the next turn). Sources: one cursor file per source class (conversations, emails, todos, knowledge, custom CLI verb) — declarative, the cursor defines WHICH source. Keep the script bounded (<200 lines), fail-closed, secret-free.
Return (JSON): { homesWritten: [string], skillName: string, dedupeProven: bool, dedupeControl: string, honestyMatrixPresent: bool, scriptLines: number, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Real acceptance — the EXACT claim must be exercised:
1. TWO-SIDED on the primary source (conversations): the script with a fresh cursor EMITS an event for a known-new message (positive) and emits NOTHING for a known-empty window (negative). Paste the literal output lines.
2. LIVE INJECTION on opencode2 IF reachable from this machine (v2.session.prompt — the measured baseline): inject one test turn into a bounded opencode2 session and confirm the prompt API accepted it. If opencode2 is not reachable here, record the exact gate and prove the script's injection branch with the documented API contract + the baseline evidence cited in the task (pattern proven 2026-08-19 on opencode2).
3. FAIL-CLOSED: a dead source (bad cursor/verb) yields a reported error, never a quiet pass.
4. Bounded: the whole gate run <120s with a 5s poll interval.
Return (JSON): { positiveFired: bool, negativeSilent: bool, injectionProved: {live: bool, gate: string|null}, failClosedProved: bool, bounded: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) dedupe per home is PROVEN (control cited, not asserted), (b) the honesty matrix is present and names each runtime's real mechanism (no invented v2.session.prompt parity on runtimes that lack it), (c) the two-sided verify fired on known-new and stayed silent on known-empty with literal output, (d) fail-closed and secret-free, (e) create-skill standard respected (bare name, frontmatter, one folder, per-tool adaptation). Post '[REVIEW] <GO|NO_GO> — session-inject-monitor skill @ <evidence> — lens: skill authoring standard, reviewer session-inject-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const INSTALL = CONST + `
ROLE: install lane. Per the CONST: register the skill with the skills CLI ('skills' — search 'skills --help' for the register/install verb; if the CLI lacks a register verb for custom skills, record that gate and install by placing the skill in each home, which the author phase already did). Verify per home: the skill dir + SKILL.md exist in ${HOMES.join(', ')} (ls + frontmatter parse), and the script is executable. Report per-home presence as the install receipt.
Return (JSON): { registered: bool, registryVerb: string|null, homes: [{home, present: bool, adapted: bool}], receipt: string }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment ${TASK} completed (skill name, homes, verify evidence, install receipt), complete it, post to #board, save a memento (the honest per-runtime injection matrix is the durable finding). If NO_GO or acceptance not met: comment findings + resume condition, leave in_progress, post residue to #board.
Return (JSON): { taskState: string, skillName: string, homes: [string], residue: [string] }
`

const AUTHOR_SCHEMA = { type: 'object', properties: { homesWritten: { type: 'array' }, skillName: { type: 'string' }, dedupeProven: { type: 'boolean' }, dedupeControl: { type: 'string' }, honestyMatrixPresent: { type: 'boolean' }, scriptLines: { type: 'number' }, evidence: { type: 'string' } }, required: ['homesWritten', 'skillName', 'dedupeProven', 'honestyMatrixPresent'] }
const VERIFY_SCHEMA = { type: 'object', properties: { positiveFired: { type: 'boolean' }, negativeSilent: { type: 'boolean' }, injectionProved: { type: 'object' }, failClosedProved: { type: 'boolean' }, bounded: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const INSTALL_SCHEMA = { type: 'object', properties: { registered: { type: 'boolean' }, registryVerb: { type: ['string', 'null'] }, homes: { type: 'array' }, receipt: { type: 'string' } }, required: ['homes'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, skillName: { type: 'string' }, homes: { type: 'array' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Author')
const author = await agent(AUTHOR, { label: 'session-inject-author', phase: 'Author', schema: AUTHOR_SCHEMA, model: 'opus' })
log(`author: ${author && author.skillName ? author.skillName + ' homes ' + (author.homesWritten || []).length : 'FAILED'}`)

phase('Verify')
let verify = null
if (author && author.homesWritten && author.homesWritten.length) {
  verify = await agent(VERIFY, { label: 'session-inject-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'author phase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (author && author.homesWritten && author.homesWritten.length) {
  review = await agent(REVIEW, { label: 'session-inject-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'author phase did not complete', detail: JSON.stringify({ author }) }] }
}

phase('Install')
let install = null
if (review && review.verdict === 'GO' && verify && verify.acceptanceMet) {
  install = await agent(INSTALL, { label: 'session-inject-install', phase: 'Install', schema: INSTALL_SCHEMA })
} else {
  install = { registered: false, homes: [], receipt: 'skipped — GO+acceptance not met' }
}

phase('Report')
const report = await agent(REPORT, { label: 'session-inject-report', phase: 'Report', schema: REPORT_SCHEMA })

return { author, verify, review, install, report }
