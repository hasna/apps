# @hasna/test-guard — resolved test admission and descendant lifetime guard

**Task:** SC-00062 (Station Cleanup). Installed 2026-07-30. This
package is the canonical source home (added 2026-08-19, task 48d4725e): the
sentinel, the wrapper, and the battery are tracked here so the guard ships
through the normal PR → review → publish → install chain instead of living
only at the machine-local install dir `~/.hasna/test-guard`.

## Why this exists

2026-07-30: ten concurrent cron/loop-spawned `bun test` suites drove loadavg
66.9 on 20 cores. Load-starved subprocesses report `Received: null ... timed
out after 5000ms` — a timeout wearing an assertion's clothes — and agents judged
healthy repos red. `bun-test-guard.zsh` (`~/.config/hasna/`) is a shell function
bound only in interactive rc-sourced shells, so cron- and loop-spawned suites
bypassed it entirely; and it caps memory, never CPU concurrency. `earlyoom`
requires a memory+swap condition and correctly cannot fire on CPU saturation.
There was no control at any layer.

## What this is

A typed four-lane admission contract plus a **flock(2) semaphore enforced in
the runner resolution path**:

- `@hasna/test-guard/sdk` validates and deterministically classifies a fully
  resolved execution plan as `LOCAL_FOCUSED`, `CLOUD_FULL`,
  `LOCAL_DIAGNOSTIC`, or `UNCLASSIFIED`. Stable content-addressed
  classification, admission, parent/child, and terminal receipts are the
  handoff surface for Testers and host verification.
- A local focused execution requires one package, explicit finite target IDs,
  a completely resolved descendant closure, and non-null numeric memory,
  process, swap, and wall-time limits. Broad, recursive, dynamic, CI-emulating,
  lifecycle-hook, fanout, non-Bun, unresolved, and unbounded plans refuse
  before spawn.
- The shell wrapper is interception only. It never treats a command name as
  safety evidence. A focused invocation keeps the ordinary `bun test <target>`
  spelling but supplies its matching resolved plan through
  `HASNA_TEST_GUARD_RESOLVED_PLAN_FILE`; a missing, unreadable, or mismatched
  plan refuses with exit 78.

- `/home/hasna/.bun/bin/bun` is a bash wrapper (marker: `hasna-test-guard
  wrapper`). Source of truth: `bun-wrapper.sh` in this package.
- The real bun binary lives at `/home/hasna/.bun/bin/bun-real`.
- Both `bunx` symlinks (`~/.bun/bin/bunx`, `~/.local/bin/bunx`) point at the
  wrapper; argv0 is preserved with `exec -a` so bunx semantics survive.
- After a `LOCAL_FOCUSED` admission, the wrapper acquires one of `MAX_SLOTS`
  (default **4**) slot locks under `slots/`. The wrapper retains the lock after
  the direct launcher exits and releases it only after systemd reports a
  terminal scope and the complete recursive cgroup reports `populated 0`.
  Ambiguous scope setup, accounting, or terminal evidence fails closed.
- The local workstation controller dependency is the stable user-systemd unit
  `hasna-tests.slice`. `@hasna/machines` owns provisioning and aggregate host
  controls for that slice. `@hasna/test-guard` does not derive or provision
  those controls: before allocating or spawning it queries the exact unit and
  requires one loaded, active controller with memory accounting, finite
  aggregate `MemoryMax` and `TasksMax`, and `MemorySwapMax=0`.
- After acquiring a slot, Linux suites enter a transient systemd user scope
  bound by `--slice=hasna-tests.slice`, with narrower `MemoryHigh=12G`,
  `MemoryMax=16G`, `MemorySwapMax=0`, and `TasksMax=4096`. The runtime proves
  its current cgroup is exactly the named leaf scope beneath that aggregate
  slice before it writes an ADMIT receipt or starts the test. Preflight
  failures return exit 78; runtime `systemd-run`
  failures propagate their nonzero status. Sanitized cron/agent environments
  reconstruct the caller's own `/run/user/<uid>` transport after validating
  its ownership and permissions, then remove the synthetic variable before
  entering bun so the caller's environment contract remains exact. A suite
  already inside an intentionally bounded test scope is not nested again.
- Child plans inherit the parent lane, allocation, lease, cgroup, and remaining
  budget. They can narrow scope and consume that budget, but cannot widen it or
  acquire a second local allocation. Missing, stale, or mismatched parent
  evidence refuses before spawn.
- If all slots are busy the invocation **queues FIFO** up to `MAX_WAIT_SECS`
  (default **1800**), then fails LOUDLY with exit 75 and a message naming the
  guard — never runs unbounded (fail-closed). FIFO (added 2026-07-30, same
  day): each waiter files a ticket `<ns>.<pid>` under `queue/`; only the
  oldest live ticket may probe the slots. The original bare probe loop starved
  sleepers — production measured a suite waiting 1330s while later arrivals
  took freed slots at waited=0s. Dead owners' tickets are reaped (process
  liveness + hard staleness cap of MAX_WAIT+120s), so a killed waiter cannot
  wedge the queue indefinitely.
- **Incident 2026-07-30 14:27Z** (posted to #incidents, id 608183): the first
  FIFO deployment called `try_slots` without forwarding `"$@"` — 21 production
  `bun test` runs got bare-`bun` help output with rc=0 (false green) in a 60s
  window. Fixed 14:28:00Z. Consequence: the sentinel now carries an
  END-TO-END functional probe (canary suite through the wrapper in an isolated
  guard dir; requires rc=0 + '1 pass' + the exact cgroup limits + an
  `acquired ... argv=test` log line),
  because marker presence is not evidence the cap works.
- Nested execution under a slot-holding suite skips acquisition only when its
  allocation, lease, cgroup, resource bounds, and resolved child evidence
  match. A marker alone is not parent evidence.
- `HASNA_TEST_GUARD_BYPASS=1` cannot bypass focused admission or allocation;
  it refuses with exit 78 and is logged.

Config override: `config` in the guard dir (sourced), e.g. `MAX_SLOTS=6`.
Evidence log: `guard.log` (every acquisition, wait, bypass, timeout) +
journald tag `hasna-test-guard`.

## Why this layer

- `CPUQuota` on `cron.service` was rejected: on the guard machine the ENTIRE agent
  estate (tmux, claude sessions, MCP servers, ~1280 tasks) lives inside
  `system.slice/cron.service`, so a quota there throttles every live agent —
  including work already running, which the rollout constraint forbade — and
  it caps CPU share, not suite concurrency, so timeout-starvation persists.
- An interactive shell function cannot bind cron/loop spawns (the original
  defect). This wrapper sits at the one filesystem path every `bun` invocation
  on this box resolves through (PATH and absolute-path alike), so a process
  whose author never heard of the control is still enrolled.

## Known gaps (documented, monitored where possible)

1. Executing `/home/hasna/.bun/bin/bun-real test` directly bypasses the cap
   (deliberate escape hatch; audit via guard.log absence + process listings).
2. Non-Bun runners are classified `CLOUD_FULL`; they are never admitted to a
   local focused allocation by this package.
3. `bun run test` is lifecycle expansion and refuses locally. The resolved
   cloud plan, rather than the wrapper's command spelling, owns that suite.
4. A fresh bun reinstall (curl installer) replaces the wrapper. `bun upgrade`
   through the wrapper updates bun-real and is safe. The **sentinel** catches
   the clobber case and (since 0.0.3, row 7112181b) **auto-rearms**: it
   restores the wrapper from the package source and re-pins bun-real to the
   fleet-pinned 1.3.14 build (sha `37141662ebed915a…`, sha-verified) instead
   of only alerting. A rearm only exits the sentinel as healthy after the
   wrapper marker, the byte-identical wrapper, the pinned bun-real version,
   and the end-to-end canary (rc=0, '1 pass', exact cgroup limits,
   `acquired ... argv=test`) all pass; an unverifiable rearm keeps the alert
   path (fail-closed).
5. Pre-subcommand flag spellings and `bun run` expansion are intercepted but
   refused unless a future package-owned resolver can prove their complete
   closure. They do not bypass the guard.
6. A SIGKILLed waiter whose pid is recycled before the next liveness sweep can
   hold the queue head until the staleness cap (MAX_WAIT+120s) — negligible
   probability and explicitly bounded. The reaper intentionally avoids
   cmdline identity checks because those broke FIFO for valid relative and
   alternate wrapper paths.

- **Incident 2026-07-30 13:19-14:59Z, defect #4** (#incidents 608485): the
  wrapper's plain `#!/usr/bin/env bash` shebang sourced the caller's
  `$BASH_ENV` (the retired internal cloud-runtime env file) on every invocation, silently
  reverting `env -u` unsets and clobbering explicit overrides of the 9
  todos/conversations/mementos routing variables back to production cloud
  values. Fixed with `#!/bin/bash --posix` (posix non-interactive bash sources
  nothing). The wrapper's contract is: **the caller's environment reaches
  bun-real EXACTLY as given.** `battery.sh` is the 53-check regression sweep
  (env fidelity, cgroup limits, HELD validation, scope/lock lifetime, FIFO,
  fail-closed behavior, and sentinel coverage, including the ac4558ab
  canary-state classification) — run it after ANY change to the wrapper or
  sentinel, on both stations.

## Sentinel (the cap watching itself)

`sentinel.sh`, cron-scheduled every 20 min, INDEPENDENT of the loops runtime:
verifies wrapper marker + bun-real viability + slots dir; posts [ALERT] to
#incidents (damped 6h) on failure. Its heartbeat: `sentinel.log`. Since the
ac4558ab fix it classifies a failed functional probe per state — rc=78
(engaged, degraded), rc=124 with acquisition (engaged, saturated), rc=124
without (unverifiable) — and words the NOT ENGAGED alert only for wrapper
missing or silent bypass. Since 0.0.3 (row 7112181b) the sentinel also
AUTO-REARMS the clobber classes (marker missing / integrity mismatch): it
restores the wrapper from the package source (atomic `.new` + `mv -f`) and
re-pins bun-real to the fleet-pinned 1.3.14 build (sha-verified: the 
clobbering ELF is promoted if it matches the pinned sha, else a
sha-verified download of the pinned release, cached in the guard dir's
`pinned/` store), then requires the full static chain AND the functional
canary to pass before it may exit 0. An unverifiable rearm fails closed into
the alert path. Pin constants are config-overridable
(`PINNED_BUN_VERSION` / `PINNED_BUN_SHA256` / `PINNED_BUN_ASSET` in the guard
dir's `config`); the recorded sha is the aarch64 build this machine's bun.sh
installer installs — on a different-arch host, set the matching sha in
`config` or the sentinel keeps alerting (fail-closed, never promotes an
unverified binary).

## Tests

- `bun test test/execution-lanes.test.ts --max-concurrency 1` exercises the
  typed classifier, refusal-before-spawn sentinel, parent/child budget and
  allocation inheritance, and stable terminal receipts.
- `bash test/controller-enforcement.sh` uses hermetic `systemctl` and
  `systemd-run` seams to prove controller-state refusal before spawn, exact
  aggregate slice binding, resistance to forged environment claims, and real
  cgroup ancestry admission.
- `bash test/descendant-lifetime.sh` drives the real wrapper against a hermetic
  fake systemd/cgroup surface and proves the slot remains unavailable after the
  direct launcher exits until the descendant makes the cgroup empty.
- `bun run test` (in this package) runs the hermetic smoke: battery sections 16
  (sentinel canary-state classification) and 17 (auto-rearm on a temp-dir COPY
  of the bin layout) against the repo copies. No machine guard install needed.
- `battery.sh` remains the full historical regression sweep (sections 1-17,
  60 checks). It is package-wide and therefore belongs to the `CLOUD_FULL`
  lane; do not run it locally while that cloud lane is unavailable. The
  eventual cloud invocation retains the installed-guard inputs below:

  ```bash
  BUN_TEST_GUARD_SENTINEL=<repo>/sentinel.sh \
  BUN_TEST_GUARD_WRAPPER_SOURCE=<repo>/bun-wrapper.sh \
    bash <repo>/battery.sh
  ```

## Reinstall (if clobbered)

Since 0.0.3 (row 7112181b) the sentinel AUTO-REARMS the clobber within one
20-minute firing — restore the wrapper from the package source and re-pin
bun-real to the fleet-pinned 1.3.14 build (sha-verified), then require the
full static chain and the functional canary before declaring health. The
manual path below remains for a machine whose rearm cannot verify:

```bash
cp -p /home/hasna/.bun/bin/bun /home/hasna/.bun/bin/bun-real   # only if bun is a real ELF again
install -m 0755 <repo>/bun-wrapper.sh /home/hasna/.bun/bin/bun.new
mv /home/hasna/.bun/bin/bun.new /home/hasna/.bun/bin/bun        # atomic
bun --version && bunx --version                                  # sanity
```

The live install directory `~/.hasna/test-guard` is updated from this package
(byte-identical copies); never edit the live copies without landing the change
here first.

## Atomic rollback

Each rollout keeps the replaced files beside their live paths with a
`.pre-<task>` suffix. Restore the wrapper and its source from the same backup
generation; never mix generations. Stage each replacement as `.new`, verify
its SHA-256 against the selected backup, then rename it over the live path.
Finally run `bun --version`, `bunx --version`, `battery.sh`, and
`sentinel.sh`. A rollback is not complete until all four checks pass.

The semaphore is an accidental-saturation control, not a security boundary.
An explicitly logged `HASNA_TEST_GUARD_BYPASS=1` invocation can bypass it, and
a nested `HASNA_TEST_GUARD_HELD` marker is accepted only inside an already
equal-or-tighter cgroup. Therefore "machine-wide maximum" means ordinary
top-level `bun test` invocations through the fleet wrapper.
