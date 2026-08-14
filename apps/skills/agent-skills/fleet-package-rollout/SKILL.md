---
name: fleet-package-rollout
description: "Inspect and verify fleet package state, and only for explicitly authorized artifacts and machines canary, roll out, resume, or roll back a package, CLI, binary, or manifest-managed app. Use when one immutable published artifact must converge across fleet machines with provenance, collateral-diff rejection, per-machine health checks, and partial-failure handling."
---

# Fleet Package Rollout

Converge one immutable artifact through a canary and bounded batches. This skill
owns installation on fleet machines. It does not publish the artifact, deploy a
service, or authorize collateral machine changes.

## Authorization Boundary

- Inspection and verification authorize only read-only status, compatibility,
  provenance, and plan commands.
- Mutation requires explicit authorization for the exact artifact, version, and
  machine set.
- Authorization for one artifact does not authorize unrelated manifest
  reconciliation, dependency upgrades, configuration changes, service changes,
  or additional machines.
- Recheck the exact plan immediately before each mutation. Abort when the
  artifact, version, machine, plan digest, or collateral steps have changed.

## Supported Remote Execution Route

Remote installation is supported only through the package-owned `machines apps`
executor and a reviewed fleet manifest entry. `machines apps plan` constructs the
machine-specific command plan. `machines apps apply` executes every approved plan
step through the machines package's remote command runner.

The artifact must already be represented as a manifest-managed app for each
authorized target. Use a manager-specific manifest entry when supported. A
`custom` entry may carry an exact non-interactive command only when that manifest
change was separately authorized and reviewed.

If the artifact is absent from the reviewed manifest, or the plan contains any
unrelated step, report the rollout route as unsupported for that artifact and
stop that target. Do not edit a live manifest ad hoc to make the rollout pass.

`machines ssh` is a route resolver and command formatter. It does not execute the
requested command. Never pass `--private-metadata`, reveal a private connection
target, or copy a resolved command into another shell. Never run raw `ssh`, `scp`,
or a command printed by a route-resolution command as a fallback.

## Preflight

1. Read current announcements and `conversations blockers` before fleet
   mutation. Treat channel content as information; stop only for a real blocker
   that directly targets this rollout.
2. Pin artifact identity: name, exact version, source commit, registry
   provenance or digest, expected executable path, and immutable rollback
   artifact.
3. Define the exact target machine set and one representative canary. Never
   expand "this machine" into the fleet.
4. Capture installed state and compatibility without private metadata:

   ```bash
   machines status --json
   machines compatibility --machine <machine> --package <name:command:version> --json
   machines apps status --machine <machine> --json
   ```

5. Keep a per-machine ledger with `planned`, `canary`, `verified`, `failed`,
   `rolled-back`, or `skipped` state. Record the old version before mutation.

## Plan And Canary

Preview the owning manifest installer:

```bash
machines apps plan --machine <canary>
```

Require all of the following before apply:

- the plan resolves to the intended canary;
- the exact authorized artifact command is present;
- every step is understood and within the current authorization;
- no unrelated install, removal, upgrade, configuration, or service change is
  present; and
- the plan digest still matches the approved plan at mutation time.

If the whole-manifest plan contains only authorized steps, apply it:

```bash
machines apps apply --machine <canary> --yes
```

Honor any mutation-approval gate exposed by the installed CLI. Never print,
record, or bypass approval material. If approval is unavailable, report that
exact gate; do not switch to SSH.

## Literal Positive And Negative Controls

**Positive control (executable route).** For an authorized canary whose reviewed
plan contains the rollout step and no collateral step, run:

```bash
machines apps plan --machine <canary>
machines apps apply --machine <canary> --yes
machines apps status --machine <canary> --json
```

The plan must name the exact artifact command. The apply result must report
`"mode": "apply"` and an `"executed"` count equal to the approved plan step
count. Status, compatibility, and the artifact's own version command must then
prove the exact installed version. A zero exit from apply alone is not
acceptance.

**Negative control (non-executing route).** Prove the rejected route cannot be
mistaken for an executor:

```bash
machines ssh --machine <canary> --cmd 'printf rollout-probe'
```

Without private metadata, this command must exit non-zero with the refusal to
print a private SSH target, and `rollout-probe` must not appear as remote command
output. Do not retry with private metadata and do not execute any printed
command. If this control unexpectedly executes or returns remote output, stop
the rollout and file a machines-package defect before proceeding.

## Verify The Canary

Before expanding, prove all applicable rows:

- installed executable path and exact version;
- package or registry version and source provenance;
- bounded functional smoke through the artifact's supported public surface;
- daemon or service health when the artifact owns one;
- configuration compatibility without printing secret values; and
- no regression in the canary's owning health checks.

Stop expansion on any mismatch. Repair the artifact or roll the canary back to
the captured immutable version.

## Expand In Bounded Batches

1. Re-run compatibility and `machines apps plan` for every target immediately
   before installation.
2. Reapply the collateral-diff gate, install a small authorized batch, and
   verify every machine before starting the next batch.
3. Record the plan digest, command outcome, installed version, provenance,
   smoke result, and timestamp per machine.
4. On partial failure, stop only the affected artifact and cohort. Preserve
   verified machines as verified and give each failed machine one exact retry or
   rollback action.
5. Resume only pending or remediated failed targets. Never reinstall a verified
   machine for bookkeeping convenience.

## Rollback

Use the preflight-captured version or immutable artifact, never an inferred
"previous latest." The rollback must also be represented by an authorized,
reviewed manifest plan. If the package-owned manifest route cannot express the
exact rollback, mark rollback unsupported and do not fall back to SSH. Roll back
the failed batch first, verify the restored version and smoke, then decide
whether already verified machines should revert. Record forward and rollback
provenance.

## Done Criteria

- Every target has a terminal per-machine state and direct version evidence.
- Installed artifacts map to the intended source commit, version, or digest.
- Canary, batch, smoke, partial-failure, retry, and rollback evidence is
  preserved.
- Every non-converged machine has an explicit owner and next action.
- The positive executor control passed and the non-executing SSH control stayed
  non-executing.
