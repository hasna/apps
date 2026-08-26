export const meta = {
  name: 'closed-pr-audit',
  description: 'Standing audit lane (owner 2026-08-26; policy decided by Sol consult + binding Fable ruling, row e76b2ed3): sweep CLOSED-unmerged PRs across the five monorepos (hasna/apps, hasna-internal/internal-apps, hasna-internal/harnesses, hasna-internal/business-engines, hasna-internal/products), classify L (legitimate) / W1-W3 (wrongly closed, positive evidence) / X4-X5 (absence-based, suspected only), file ONE todos row + ONE [WRONG-CLOSE]/[WRONG-CLOSE-ABSENCE-BASED] evidence comment per flagged PR, NEVER open or close a PR. Reopen is the owning drain lane\'s decision, for the W2 class ONLY, against a named predicate verified at decision time. Infinite session-scoped loop; idle census sleeps 30 min between passes. Deterministic by construction.',
  phases: [
    { title: 'Census', detail: 'per repo, page closed-unmerged PRs (state=closed, mergedAt=null) with cursors to exhaustion; report window/cursor/bound; resolve linked tasks fresh' },
    { title: 'Classify', detail: 'L / W1-W3 / X4-X5 per the ruling taxonomy; positive evidence required for W; absence-based is X, labeled "may be legitimate; verify"' },
    { title: 'Record', detail: 'one todos row + one greppable evidence comment per W/X PR; ledger incl. L classes + positive controls; dedupe by PR identity; never re-comment/re-file' },
    { title: 'Reopen-Route', detail: 'NO reopen from this lane. W2 rows carry the [REOPEN-CANDIDATE] tag + named predicate; the owning drain lane reopens the SAME PR against the predicate at decision time' },
  ],
}

// --- safeAgent hardening (O15-00732 + prose guard, PR #1213) ---
let agentFailed = false
const safeAgent = async (prompt, opts) => {
  try {
    const r = await agent(prompt, opts)
    if (opts && opts.schema && (typeof r !== 'object' || r === null)) {
      agentFailed = true
      const label = (opts && (opts.label || opts.phase)) || 'agent'
      log('AGENT-PROSE (' + label + '): schema requested but the agent returned a non-object result — treating as failure; next pass census sleeps 300s first')
      return null
    }
    return r
  } catch (err) {
    agentFailed = true
    const label = (opts && (opts.label || opts.phase)) || 'agent'
    log('AGENT-FAILURE (' + label + '): ' + (err && err.message ? err.message : String(err)) + ' — continuing; next pass census sleeps 300s first')
    return null
  }
}
const censusPrompt = (body) => {
  if (agentFailed) {
    agentFailed = false
    return "NOTE: a previous pass's agent FAILED (a subagent returned prose instead of StructuredOutput, or another transient error). Sleep 300 (bash) FIRST, then run this census exactly as instructed — the lane is waiting out the transient condition.\n\n" + body
  }
  return body
}
// --- /safeAgent ---

const REPOS = [
  { org: 'hasna', name: 'apps', channel: 'apps', todosProject: '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8' },
  { org: 'hasna-internal', name: 'internal-apps', channel: 'hasna-internal-apps', todosProject: null },
  { org: 'hasna-internal', name: 'harnesses', channel: 'hasna-internal-harnesses', todosProject: null },
  { org: 'hasna-internal', name: 'business-engines', channel: 'hasna-internal-business-engines', todosProject: null },
  { org: 'hasna-internal', name: 'products', channel: 'hasna-internal-products', todosProject: null },
]

const CENSUS = {
  type: 'object',
  properties: {
    window: { type: 'string' },
    bound: { type: 'string' },
    perRepo: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          scanned: { type: 'integer' },
          closedUnmerged: { type: 'integer' },
          classified: { type: 'object' },
        },
        required: ['repo', 'scanned', 'closedUnmerged', 'classified'],
      },
    },
    flagged: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          repo: { type: 'string' },
          prNumber: { type: 'integer' },
          title: { type: 'string' },
          headSha: { type: 'string' },
          closedAt: { type: 'string' },
          closedBy: { type: 'string' },
          taskId: { type: ['string', 'null'] },
          taskTitle: { type: ['string', 'null'] },
          taskStatus: { type: ['string', 'null'] },
          klass: { type: 'string', enum: ['W1', 'W2', 'W3', 'X4', 'X5'] },
          evidence: { type: 'array', items: { type: 'string' } },
          predicate: { type: ['string', 'null'], description: 'W2 only: the named reopen predicate' },
        },
        required: ['repo', 'prNumber', 'title', 'headSha', 'closedAt', 'closedBy', 'klass', 'evidence'],
      },
    },
    positiveControls: {
      type: 'object',
      properties: {
        legitimateCloseClassifiedL: { type: 'boolean' },
        knownW2ClassifiedW2: { type: 'boolean' },
      },
      required: ['legitimateCloseClassifiedL', 'knownW2ClassifiedW2'],
    },
  },
  required: ['window', 'bound', 'perRepo', 'flagged', 'positiveControls'],
}

const RECORD = {
  type: 'object',
  properties: {
    rowsFiled: { type: 'integer' },
    commentsPosted: { type: 'integer' },
    skippedDedup: { type: 'integer' },
    channelLine: { type: 'string' },
  },
  required: ['rowsFiled', 'commentsPosted', 'skippedDedup', 'channelLine'],
}

// Infinite drain loop (owner design 2026-08-25): census each pass; flagged sets
// converge to zero via the drain lanes; idle census sleeps 30 min and re-checks.
const seen = new Set() // bounded dedupe by PR identity (repo#number)
let pass = 0
for (pass = 1; ; pass++) {
  phase('Census')
  const census = await safeAgent(censusPrompt(`Census CLOSED-unmerged PRs across the five monorepos. PASS ${pass} of the infinite loop. PRIORITY YIELD CHECK FIRST: todos list --project 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8 --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-check once, return {window, bound, perRepo: [], flagged: [], positiveControls: {legitimateCloseClassifiedL: true, knownW2ClassifiedW2: true}} and do NOT probe GitHub while yielding.

THE TAXONOMY (binding Fable ruling 2026-08-26, row e76b2ed3; Sol consult taxonomy enriches the evidence classes):

FOR EACH REPO (${REPOS.map(r => r.org + '/' + r.name).join(', ')}):
1. Page closed PRs (gh pr list --repo <org>/<name> --state closed --json number,title,headRefOid,closedAt,mergedAt,author --limit 100, redirect to a file, never pipe). A PR is closed-UNMERGED when mergedAt is null (state closed ≠ merged). Exclude PRs older than 14 days. Page with --page N to exhaustion; record the window and the bound — NEVER claim a full-census result from a capped read.
2. For EACH closed-unmerged PR, resolve the linked todos task FRESH (todos search or the task id in the PR body/title; the link must be explicit — title/branch-name similarity is NOT sufficient; if no task can be linked, the task fields are null). Then classify:

- L (LEGITIMATE — ledger only, never commented, never flagged): superseded-by-merged #N (the successor is MERGED and carries the same work); duplicate-of-merged #N (verified to carry the work, not inferred from the word); owner-directed/won't-do evidenced on ANY record surface (task comment, channel post, decision log — not just the PR); stale-and-replaced via a live successor; NO_GO routed elsewhere and progressing.
- W1 (task-owed): linked task pending/in_progress at close AND still pending at census.
- W2 (go-green-closed): W1 PLUS a recorded [REVIEW] GO verdict found on the PR or the linked row at the CURRENT head sha PLUS required checks green at that head PLUS no open or recently-merged successor. This is the ONLY reopenable class — carry the named predicate: task still pending and owned; no successor; head sha matches the verdict sha and the merge-tree of current base + head is unchanged from what the reviewer read (else rebase and re-review the delta); required checks green at that head or a documented waiver; no owner/human-directed close on any surface the drain lane reads.
- W3 (no-go-unaddressed): a NO_GO whose concrete P0/P1 findings were never addressed, the review cycle never reached a terminal GO, and the task is still pending.
- X4 (undocumented-close — SUSPECTED, never confirmed): no verdict, no closure comment, no supersede/duplicate citation, task pending. Label "may be legitimate; verify" — absence of a reason is a documentation failure, not proof the closure was wrong.
- X5 (bulk-move-orphan — SUSPECTED): closed under a bulk operation, no successor PR, no reassigned task row at the destination. Label "may be legitimate; verify".

INTENTIONAL classes are NEVER flagged: owner/human-directed close on any surface; superseded by a merged PR; duplicate of a merged PR; linked task completed, cancelled, or re-scoped off the pending set; NO_GO routed elsewhere and progressing; bulk-move whose destination received the artifact; any live successor PR carrying the same work.

3. POSITIVE CONTROLS each pass (they make the pass non-vacuous): (a) one known-legitimate close (e.g., a superseded-by-merged PR from the window) MUST classify L; (b) one known W2 (a GO'd + green + task-pending close from the window or a synthetic fixture) MUST classify W2. If a control fails, the pass result is suspect — record it.

Return the census: window (ISO range scanned), bound (the explicit limit/end of the paged reads), perRepo (scanned + closed-unmerged counts + classified counts), flagged (one entry per W/X PR with repo, prNumber, title, headSha, closedAt, closedBy, taskId/taskTitle/taskStatus read fresh, klass, evidence — the raw lines pasted — and predicate for W2), positiveControls (both booleans). Read-only: never open, close, comment, or file anything in this phase.`, { label: 'closed-pr-census:' + pass, phase: 'Census', schema: CENSUS, model: 'sonnet' }))

  if (!census || !census.flagged || !Array.isArray(census.flagged)) {
    log(`pass ${pass}: census failed or malformed — re-checking next pass`)
    continue
  }

  phase('Record')
  const record = await safeAgent(`RECORD phase for the closed-PR audit pass ${pass}. Census summary: window ${census.window}, bound ${census.bound}, per-repo ${census.perRepo.map(r => r.repo + ':' + r.scanned + 'scanned/' + r.closedUnmerged + 'closed-unmerged').join('; ')}, positive controls ${JSON.stringify(census.positiveControls)}.

THE RULING'S RECORD SHAPE (binding):
1. For EACH flagged PR (${census.flagged.length} flagged): file EXACTLY ONE todos row in the owning monorepo's task list (hasna/apps → project 3bbc22e0; internal repos → their own project; if the project is unknown, use 3bbc22e0 and note it) titled "WRONG-CLOSE ${klass}: <repo>#<prNumber> — <short title>" with tags health,workflows, the class, PR identity, head sha, close time, closed_by, linked task uuid/title/status (read fresh), the evidence lines, and for W2 ONLY the [REOPEN-CANDIDATE] tag plus the named predicate. NEVER file a row for an L class.
2. Post EXACTLY ONE comment on each flagged PR: first line "[WRONG-CLOSE]" (W1/W2/W3) or "[WRONG-CLOSE-ABSENCE-BASED]" (X4/X5) + " — <repo>#<n> may be legitimate; verify" for X classes; then the raw evidence lines pasted verbatim. For W2 add: "REOPEN-CANDIDATE — reopen decision belongs to the owning drain lane against the named predicate; this lane never reopens."
3. DEDUPE: maintain a bounded seen-set keyed by repo#number (the census passes it via the pass counter; skip any PR already handled — check for an existing comment with the [WRONG-CLOSE] marker or an existing row with the WRONG-CLOSE title before filing/commenting). NEVER re-comment or re-file a handled PR.
4. ONE line to the owning channel per repo with flagged counts (or one consolidated line to #apps when the internal repos share no channel): "closed-pr-audit pass ${pass}: <repo>#<n> W2 [REOPEN-CANDIDATE], <repo>#<n> X4 (verify) ..." — no ids without their meaning.
5. Return {rowsFiled, commentsPosted, skippedDedup, channelLine}.`, { label: 'closed-pr-record:' + pass, phase: 'Record', schema: RECORD }))

  if (census.flagged.length === 0) {
    log(`pass ${pass}: no flagged PRs — ledger clean, controls ${JSON.stringify(census.positiveControls)}; sleeping 30 min via next census`)
  } else {
    log(`pass ${pass}: ${census.flagged.length} flagged (rows ${record ? record.rowsFiled : '?'}, comments ${record ? record.commentsPosted : '?'}, dedup ${record ? record.skippedDedup : '?'})`)
  }
  // The loop continues; the next census sleeps 30 min when idle (the census prompt instructs it).
}
