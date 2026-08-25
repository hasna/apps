# hasna/apps workflow store

Canonical home for the hasna/apps standing lanes and reusable Workflow-tool
scripts. Invocation is `scriptPath`-based (the Workflow tool); this directory
is the version-controlled, shareable store. Naming per
`hasna-workflow-construction-taxonomy` (k_mt7cz1d4_irbyhg) and the
`hasna-loop-naming-convention` family grammar: bare kebab-case, NO version or
cadence suffixes (revision cycles live in the meta/description, not the name).

## Durable set — the lanes "we need here"

| script | kind (taxonomy axis 1) | role |
|---|---|---|
| `pr-drain-wf.js` | coordinate-steer / review-verify | standing PR review-fix-merge drain, drain-to-zero loop (rebase/review/merge are internal steps; verdict-at-head + base-movement gates) |
| `task-drain-apps-wf.js` | coordinate-steer / fix-and-ship | standing BUG-row drain in todos 3bbc22e0, drain-to-zero loop (idempotency gate → worktree → PR → review → merge → record) |
| `publish-all-apps-wf.js` | build-and-deploy | standing release lane for versioned `@hasna/*` members, drain-to-zero loop (publish law; codewith review per candidate) |
| `deploy-apps-wf.js` | build-and-deploy | standing deploy lane to oss-fleet-prod ECS, drain-to-zero loop (build arm64 → ECR → migrate → task def → update → live test; [DEPLOY INTENT]/[DEPLOY-CONFIRM]) |
| `move-app-to-internal-wf.js` | build-and-deploy | move one or more apps from this public tree into hasna-internal/internal-apps (parameterized APPS array; precedent: datasets move) |
| `fix-lane-wf.js` | fix-and-ship | generic bug-fix lane template (regression-first, PR-first, one review, merge) |
| `ship-latest-wf.js` | build-and-deploy | version-wave shipper (sole owner of wave PRs per Fable verdict A 2026-08-19) |
| `stale-pr-drain-wf.js` / `stale-tasks-wf.js` | coordinate-steer | stale-backlog reconcile class |

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

## Standing lanes drain to zero (owner design, 2026-08-25)

The standing lanes (pr-drain, task-drain-apps, publish-all-apps, deploy-apps)
are single-workflow loops, not one-pass scripts: each pass ends by re-running
its census, and while the backlog is non-zero the pass restarts inside the
same run. The loop exits when the census returns zero actionable items, or at
a hard pass bound (the finite stop condition). Rebase/review/merge are steps
inside pr-drain, never standalone workflows.

## Governance (axis 4, per the construction taxonomy)

- Mandatory adversarial review; Fable reviewers; two-cycle remediation cap.
- Declared finite stop condition per workflow (live-test path, PASS/FAIL
  shape, iteration bound) — exhausting the bound stops and reports verbatim.
- Posts to hasna/conversations; saves hasna/mementos; dedup before filing.
- Workflow definitions are themselves review candidates (bounded review).
