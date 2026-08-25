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
| `pr-drain-wf.js` | coordinate-steer / review-verify | standing PR review-fix-merge drain (census → rebase → review → merge → report; verdict-bound holds; base-movement gate) |
| `task-drain-apps-wf.js` | coordinate-steer / fix-and-ship | standing BUG-row drain in todos 3bbc22e0 (idempotency gate → worktree → PR → review → merge → record) |
| `publish-all-apps-wf.js` | build-and-deploy | standing release lane for versioned `@hasna/*` members (publish law; codewith review per candidate) |
| `deploy-apps-wf.js` | build-and-deploy | standing deploy lane to oss-fleet-prod ECS (build arm64 → ECR → migrate → task def → update → live test; [DEPLOY INTENT]/[DEPLOY-CONFIRM]) |
| `fix-lane-wf.js` | fix-and-ship | generic bug-fix lane template (regression-first, PR-first, one review, merge) |
| `rebase-lane-pass-wf.js` | review-verify | rebase-pass primitive (ambiguous-abort discipline; no mechanical merges) |
| `ship-latest-wf.js` | build-and-deploy | version-wave shipper (sole owner of wave PRs per Fable verdict A 2026-08-19) |
| `stale-pr-drain-wf.js` / `stale-tasks-wf.js` | coordinate-steer | stale-backlog reconcile class |

## Repetitive classes and their canonical homes

One-off lanes in this directory are instances of recurring classes; the class
is owned by the durable lane, not by the one-offs:

| recurring class | instances (examples) | canonical home |
|---|---|---|
| bug fix lanes | `*-fix-wf.js`, `*-remediate-wf.js` (~60) | task-drain-apps + fix-lane |
| rebase/remediation cycles | `*-r1/r2/r3-wf.js`, `rebase-*-wf.js` | pr-drain + rebase-lane-pass |
| release/ship waves | `wave670-*`, `todos-release-wf`, `recordings-ship-wf` | publish-all-apps + ship-latest |
| deploys | `subscriptions-deploy-rerun-wf.js`, `deploy-subscriptions-wf.js` | deploy-apps |
| successor lanes | `*-successor-wf.js` | task-drain re-dispatch |
| loops runtime fixes | `loops-*-fix-wf.js`, `loops-runner-episodes-wf.js` | task-drain + deploy-apps |
| test-guard machinery | `testguard-*`, `test-guard-*` | owning test-guard domain |

A one-off that recurs a second time becomes a task for the owning lane, per
the four-artefacts doctrine (rule + taxonomy + workflow + abstraction).

## Governance (axis 4, per the construction taxonomy)

- Mandatory adversarial review; Fable reviewers; two-cycle remediation cap.
- Declared finite stop condition per workflow (live-test path, PASS/FAIL
  shape, iteration bound) — exhausting the bound stops and reports verbatim.
- Posts to hasna/conversations; saves hasna/mementos; dedup before filing.
- Workflow definitions are themselves review candidates (bounded review).
