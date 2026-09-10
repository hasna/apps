# Affected CI on four isolated runners

`ci.yml` keeps the required **build + test (affected)** check and the four
independent secrets/conformance, standard/versioning, generated-artifact and
publish-guard jobs. Its affected lane consists of a planner, four ephemeral
Ubuntu runners and an aggregate job. Each runner executes tasks serially;
package test commands and their existing process limits stay unchanged.

## Immutable selection and complete execution

The planner resolves the existing base semantics once: the fetched
`origin/$GITHUB_BASE_REF` for a pull request, `HEAD^` for a push, or `HEAD` for a
root commit. It records both complete Turbo affected build/test dry-run graphs,
the resolved base, actual checkout commit/tree, lockfile SHA256, workflow run
and attempt, and Bun 1.3.14 / npm 11.19.0 / Turbo 2.5.4. The plan artifact's
SHA256 is passed separately through the planner output.

Every executable affected test appears in exactly one of four bins. Duration
estimates select placement only: unknown tests receive the default estimate
and stale estimates cannot add or remove tasks. Longest estimated components
are assigned first, with task ID and shard index providing stable ties. Tests
that depend on other tests stay together, so ordinary Turbo dependency
expansion cannot execute them on multiple runners.

Each runner verifies the immutable identity and manifest commands, repeats the
entire affected build serially, then passes its package-qualified test IDs as
individual process arguments to Turbo. The selected dry-run graph must equal
the planned dependency closure. There is no `--only` shortcut. Build nodes with
Turbo's `NONEXISTENT` command remain explicit no-command placeholders; they are
never reported as executed builds. A new unsupported task kind or no-command
test fails planning until its semantics are explicitly supported.

Every shard starts with its own empty local task cache. Remote and cross-run
cache restoration are disabled. Its test phase may reuse only local build
results verified during its own earlier build phase; any test cache hit is a
failure. This repeats builds and dependency installation across runners and
trades additional runner minutes for shorter wall time.

## Acceptance and retained evidence

Raw dry-run graphs, raw Turbo execution summaries and terminal shard receipts
are retained as attempt-scoped artifacts for seven days. The aggregate imports
only Bun/Node builtins and needs no package installation. It independently
verifies checkout/run identity, plan and summary hashes, exact commands,
dependency graphs, terminal exits and the disjoint union of all planned tests.
Successful matrix status alone cannot satisfy the required check.

Missing, duplicate, cancelled, failed, skipped, foreign or changed receipts
refuse acceptance. Even an empty affected graph requires all four real shard
jobs to produce explicit no-op receipts. A killed process may leave no receipt;
the missing artifact and aggregate both fail closed. Recordings diagnostics
remain separate artifacts for each shard.

`tooling/ci/tests/standard/affected-shards-runtime.test.ts` exercises the actual
pinned Turbo executable in owned temporary repositories. It verifies full
build repetition, exactly-once tests, no-command builds, a failing package,
changed plan bytes, an empty plan and missing receipts. These fixtures establish
orchestration behavior; the candidate PR's actual Linux CI is the performance
and complete repository acceptance gate.

## Duration estimates and rollout

The initial estimates come from observed package spans in run `34477597465`,
job `102872081401`: Todos 753s, Emails 402s, Conversations 290s, Skills 264s,
Mementos 181s and Loops 171s. Recordings' 900s value is a conservative placement
guess, not a measured completion time. Unmeasured packages default to 300s.
Refresh estimates using terminal shard timing evidence; never use timings as a
coverage filter. Four bins do not guarantee a fourfold speedup, especially for
a dominant suite or connected test dependency component.

The new topology has seven job definitions and ten job instances, including
four matrix shards. Existing external release verifiers that bind the previous
five-job topology must continue to reject this shape until separately reviewed
successors understand the planner, all four shards, aggregate and immutable
artifacts. Historical release receipts and accepted publisher scripts must not
be rewritten to make them accept a new run. Hold this rollout until in-flight
releases finish, then require green candidate CI and independent review before
merge. No publisher authorization or deployment is part of this change.
