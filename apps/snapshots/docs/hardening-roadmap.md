# Hardening Roadmap Ledger

`ops/hardening-roadmap.json` is the repository coordination truth for the
`@hasna/snapshots` hardening roadmap. Its exact scope is 17 tracked items: the
`SNA-umbrella` coordination item plus `SNA-00001` through `SNA-00016`.
The umbrella depends on all 16 workstreams.

External Hasna Todos remains the task system of record. Synchronize confirmed
Todos identifiers and state into the ledger; do not infer remote status,
completion, or evidence from repository contents. When a Todos UUID is not
unambiguous, omit `todosTaskId`.

## Updating the Ledger

Supported statuses are `pending`, `in_progress`, `blocked`, and `done`. Omit
`status` when the current external state is unknown. Use this update order:

1. Synchronize confirmed titles, Todos UUIDs, dependencies, and declared
   blockers.
2. Add durable implementation, test, documentation, and machine011 evidence as
   it becomes available.
3. Run the consistency validator.
4. Set a workstream to `done` only after all required evidence exists and its
   dependencies and declared blockers are clear.
5. Set `SNA-umbrella` to `done` last, only after every workstream is
   closure-ready and no blockers remain. Keep that status only if the complete
   validator then passes.

Never fabricate a status or evidence record to make closure pass. The checked-in
ledger is intentionally incomplete until the roadmap workstreams produce the
required evidence.

## Dependencies and Cross-Plan Blockers

`dependsOn` records the dependency graph. The validator derives a cross-plan
blocker whenever a dependency is not closure-ready. `blockers` records explicit
cross-plan blockers as a referenced roadmap key plus a reason.

Both derived and declared blockers prevent a workstream from being `done`.
Unknown references, duplicate keys, self-dependencies, and cycles are invalid.
The umbrella dependency list must remain exactly `SNA-00001` through
`SNA-00016`.

## Required Closure Evidence

Every workstream requires all four evidence categories:

- `implementation`: one or more durable references with a summary.
- `tests`: one or more durable references with a summary.
- `docs`: one or more durable references with a summary.
- `machine011`: validation evidence from the required machine.

Evidence and artifact references use one of these durable forms:

- `git:<40-character-commit>:<repository-relative-path>` (optionally followed
  by `#L<line>` or `#L<start>-L<end>`). The validator requires the commit and
  referenced object to exist in this repository.
- `todos-attachment:<task-uuid>:<attachment-id>:sha256:<64-character-digest>:commit:<40-character-commit>`.
  The checksum records the expected immutable content identity and the final
  commit binds the claim to repository history. The validator checks the
  syntax and local commit; it cannot fetch, hash, or authenticate the hosted
  attachment while offline.

Bare paths, mutable URLs, placeholder schemes such as `control://`, path
traversal, and unqualified attachment identifiers are rejected. Evidence
summaries, commands, and positive-control names must be descriptive rather
than placeholders. Duplicate evidence references are rejected within a
category.

The `machine011` record must contain:

- `machine`: exactly `machine011`;
- `commitSha`: the exact 40-character lowercase commit SHA tested;
- `command`: the exact validation command;
- `exitStatus`: `0`;
- `timestamp`: an ISO 8601 date-time;
- `artifactReference`: a durable artifact or output reference; and
- `positiveControls`: at least one named control.

Each positive control records its name, exact command, exit status `0`, and
artifact reference. It must prove that the relevant test or gate actually ran,
not merely that a wrapper command returned successfully. For tmux-sensitive
changes, include a named positive control whose artifact shows the applicable
tmux test executed rather than being skipped.

The machine result and every positive-control artifact must bind to the same
`commitSha`. Positive-control names, commands, and artifact references must be
unique, and the machine result artifact cannot double as a positive-control
artifact. Timestamps must be valid ISO 8601 date-times and cannot be in the
future. The tested `commitSha` must resolve to a commit in this repository.

## Trust Boundary

This is a structural and local-provenance gate. It prevents mutable-policy,
alternate-schema, placeholder-reference, missing-commit, and malformed local
evidence from closing the roadmap. It does **not** prove that a remote command
ran, that an attachment exists remotely, or that the actor was really
machine011. Proving remote execution and machine identity requires signed
attestation infrastructure outside the current ledger model. Reviewers must
still inspect the referenced artifacts and their provenance before accepting
closure.

## Validation

Run the structural and consistency gate during normal development:

```sh
bun run validate:hardening
```

This mode exits successfully for a valid but incomplete ledger and reports
evidence gaps plus declared and derived blockers. `bun run check` includes this
normal mode.

Use the closure gate only when evaluating whether the umbrella may close:

```sh
bun run validate:hardening:complete
```

This invokes the validator with `--require-complete` and exits nonzero until all
16 workstreams are `done`, fully evidenced, dependency-ready, and blocker-free,
and the umbrella is `done`. The current ledger is expected to fail this closure
gate until those conditions are actually met.
