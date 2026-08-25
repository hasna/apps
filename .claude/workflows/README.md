# hasna/apps workflow store

Canonical home for the hasna/apps standing lanes and reusable Workflow-tool
scripts. Invocation is `scriptPath`-based (the Workflow tool); this directory
is the version-controlled, shareable store. Naming per
`hasna-workflow-construction-taxonomy` (k_mt7cz1d4_irbyhg) and the
`hasna-loop-naming-convention` family grammar: bare kebab-case, NO version or
cadence suffixes (revision cycles live in the meta/description, not the name).

**Layout (owner directive 2026-08-25): FLAT — every workflow file lives
directly in `.claude/workflows/`. There is no `scripts/` subdirectory; do not
create one.**

## The standing lanes

| script | kind (taxonomy axis 1) | role |
|---|---|---|
| `pr-drain-wf.js` | coordinate-steer / review-verify | standing PR review-fix-merge drain, drain-to-zero loop (rebase/review/merge are internal steps; verdict-at-head + base-movement gates) |
| `task-drain-apps-wf.js` | coordinate-steer / fix-and-ship | standing drain in todos 3bbc22e0 for BUG rows (fix-lane discipline) AND live-gate UNVERIFIED rows (RELEASE/SHIP/DEPLOY UNVERIFIED — gate-remediation: two independent live gates re-verify, BOTH GO -> post the missing confirm + complete, ANY NO_GO -> record the verdict + route to ONE deduped BUG row), drain-to-zero loop, CONCURRENT fix agents (each row in its own worktree via hasna/repos, claim comment, max 3 rows / 3 agents per pass) |
| `hotfix-drain-wf.js` | coordinate-steer / fix-and-ship | PRIORITY lane: drains unowned `HOTFIX:` rows in todos 3bbc22e0 (all other lanes yield to it via their census HOTFIX check) |
| `github-issues-to-todos-wf.js` | coordinate-steer / intake | DETERMINISTIC hourly lane: open GitHub issues on hasna/apps → todos rows (`GH#<n>:` prefix dedupe, exact-match only) |
| `publish-all-apps-wf.js` | build-and-deploy | standing release lane for versioned `@hasna/*` members, drain-to-zero loop (publish law; 2-agent live GO/NO-GO gates after publish, both GO before [PUBLISH-CONFIRM]) |
| `deploy-apps-wf.js` | build-and-deploy | standing deploy lane to oss-fleet-prod ECS, drain-to-zero loop (build arm64 → ECR → migrate → task def → update → live test; 2-agent live gates; [DEPLOY INTENT]/[DEPLOY-CONFIRM]) |
| `ship-latest-wf.js` | build-and-deploy | version-wave shipper (sole owner of wave PRs per Fable verdict A 2026-08-19); 2-agent live gates after merge, both GO before the wave is announced shipped |
| `stale-tasks-wf.js` / `stale-pr-drain-wf.js` | coordinate-steer | stale-backlog reconcile class (evidence-backed completion; never complete without evidence) |
| `move-app-to-internal-wf.js` | build-and-deploy | move one or more apps from this public tree into hasna-internal/internal-apps (parameterized APPS array; precedent: datasets move) |
| `fix-lane-wf.js` | fix-and-ship | generic bug-fix lane template (regression-first, PR-first, one review, merge) |
| `propagate-lanes-to-monorepos-wf.js` | coordinate-steer / ship | standing propagation lane: 4 targets (internal-apps, harnesses, business-engines, products) in parallel — parameterize + install applicable lanes into each target's own `.claude/workflows/`, own worktree via hasna/repos, PR-first, per-PR adversarial GO/NO-GO, merge on GO, update the clone, post to the target channel |

## Infinite session-scoped loops (owner design, 2026-08-25)

The standing lanes run **infinitely for the life of the session** — no pass
bound. "Run until I stop it": each pass re-censuses; while the queue is
non-zero the pass restarts inside the same run; when idle, the census agent
itself sleeps (5 min task-drain, 30 min stale/propagate, 1h issues) and
re-checks once, so the run stays alive at ~1 agent per idle window. Stop =
the owner stops the run or the session ends.

- **PRIORITY YIELD**: every lane's census checks todos 3bbc22e0 for UNOWNED
  rows titled `HOTFIX:` first — if any exist, the lane yields (sleeps and
  re-checks) and hotfix-drain owns the priority class.
- **2-agent live GO/NO-GO gates** (owner 2026-08-25): after publish/deploy/
  ship, TWO independent agents run the shipped app's real commands live
  (every bin, non-destructive verbs, `--version`/`--help` BEFORE any bind).
  Both must GO before [PUBLISH-CONFIRM] / [DEPLOY-CONFIRM] / ship announcement;
  any NO_GO files a RELEASE/DEPLOY UNVERIFIED row instead of confirming.
- **Deterministic by construction** (github-issues-to-todos): the agent
  executes a fixed procedure (gh api enumeration → exact-match dedupe →
  file); the output is a pure function of the input.

## Temporary / one-off lanes

`build-and-ship-workflows-app-wf.js` (owner-directed 2026-08-25 build of the
@hasna/workflows app: plan validate → todos → build loop → live verify →
publish → ship → 4-agent verification panel) and `harden-lanes-review-gates-wf.js`
(temporary: insert 2-agent gates into publish/deploy lanes) are stored here per
the owner's flat-layout directive; they are NOT durable lanes.

## Repetitive classes and their canonical homes

One-off lanes (per-PR fixes, single rebases, one wave) are NOT stored here —
they are instances of recurring classes and live in the session dirs that ran
them. The class is owned by the durable lane, not by the instance:

| recurring class | canonical home |
|---|---|
| bug fix lanes (`*-fix-wf.js`, `*-remediate-wf.js`) | task-drain-apps + fix-lane |
| rebase/remediation cycles (`*-r1/r2/r3-wf.js`, `rebase-*-wf.js`) | pr-drain (Rebase phase) |
| release/ship waves (`wave*-*`, `*-ship-wf.js`) | publish-all-apps + ship-latest |
| deploys (`*-deploy-wf.js`, `*-deploy-rerun-wf.js`) | deploy-apps |
| app moves to internal-apps (`*-to-internal-wf.js`, bulk moves) | move-app-to-internal |
| successor lanes (`*-successor-wf.js`) | task-drain re-dispatch |
| loops runtime fixes (`loops-*-fix-wf.js`) | task-drain + deploy-apps |
| test-guard machinery (`testguard-*`, `test-guard-*`) | owning test-guard domain |

A one-off that recurs a second time becomes a task for the owning lane, per
the four-artefacts doctrine (rule + taxonomy + workflow + abstraction).

## Governance (axis 4, per the construction taxonomy)

- Mandatory adversarial review; Fable reviewers; two-cycle remediation cap.
- Infinite loops declare their live-test PASS/FAIL shapes and per-pass
  budgets (finite per invocation; endlessness lives in the re-arm, never in
  the run — Fable ruling 2026-08-25).
- Posts to hasna/conversations; saves hasna/mementos; dedup before filing.
- Workflow definitions are themselves review candidates (bounded review).
