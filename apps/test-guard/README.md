# @hasna/test-guard — machine-wide bun test concurrency and memory guard

**Task:** SC-00062 (Station Cleanup). Installed 2026-07-30. This
package is the canonical source home (added 2026-08-19, task 48d4725e): the
sentinel, the wrapper, and the battery are tracked here so the guard ships
through the normal PR → review → publish → install chain instead of living
only at the machine-local install dir `~/.hasna/test-guard`.

## Guard home resolution (XDG home migration, task P3.3)

The guard home (slots/, queue/, config, guard.log, sentinel.log, the pinned/
store and the wrapper source copy) defaults to the legacy
`~/.hasna/test-guard` and is resolved through the `@hasna/paths` resolver
(`paths --app test-guard --kind state`) when the resolver is available **and**
the resolved XDG state home is adopted — either the operator set the
state-kind override `HASNA_STATE_HOME`, or the resolved home already holds
guard state (slots/, guard.log or sentinel.log). Until the migration phase
moves the live state there, an existing legacy install stays the effective
home and never becomes invisible on upgrade. The exact-app overrides
(`HASNA_TEST_GUARD_DIR` for the wrapper, `SENTINEL_GUARD_DIR` for the
sentinel) win unconditionally.

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

A **flock(2) semaphore enforced in the runner resolution path**:

- `/home/hasna/.bun/bin/bun` is a bash wrapper (marker: `hasna-test-guard
  wrapper`). Source of truth: `bun-wrapper.sh` in this package.
- The real bun binary lives at `/home/hasna/.bun/bin/bun-real`.
- Both `bunx` symlinks (`~/.bun/bin/bunx`, `~/.local/bin/bunx`) point at the
  wrapper; argv0 is preserved with `exec -a` so bunx semantics survive.
- On `bun test`, the wrapper acquires one of `MAX_SLOTS` (default **4**) slot
  locks under `slots/` before exec'ing bun-real. The lock fd is inherited
  across exec, so the slot is held exactly as long as the suite lives and
  releases on any exit, including SIGKILL. No daemon, no stale-lock cleanup.
- After acquiring a slot, Linux suites enter a transient systemd user scope
  with `MemoryHigh=12G`, `MemoryMax=16G`, `MemorySwapMax=0`, and
  `TasksMax=4096`. Preflight failures return exit 78; runtime `systemd-run`
  failures propagate their nonzero status. Sanitized cron/agent environments
  reconstruct the caller's own `/run/user/<uid>` transport after validating
  its ownership and permissions, then remove the synthetic variable before
  entering bun so the caller's environment contract remains exact. A suite
  already inside an intentionally bounded test scope is not nested again.
- `HASNA_TEST_GUARD_HELD` is trusted only when the current cgroup is already
  at least as strict as the requested memory, swap, and task limits. A stale or
  forged marker in an unbounded or looser scope is cleared and re-enters the
  normal semaphore/scope path.
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
- Nested `bun test` under a slot-holding suite inherits
  `HASNA_TEST_GUARD_HELD=1` and skips acquisition (no self-deadlock).
- `HASNA_TEST_GUARD_BYPASS=1` skips the semaphore for one invocation; bypasses
  are logged to `guard.log`.

Config override: `config` in the guard dir (sourced), e.g. `MAX_SLOTS=6`.
Evidence log: `guard.log` (every acquisition, wait, bypass, timeout) +
journald tag `hasna-test-guard`.

## Sandbox / container degradation (I38-00746)

The cap exists to protect the shared fleet station, and the fleet stations
are bare hosts. Codewith sandboxes (e2b Docker containers) carry the fleet
wrapper install but have **no systemd user scope** (no `systemd-run`, no
`/run/user/<uid>`) and a **read-only guard dir** (baked image layer), so
before this fix every `bun test` inside a sandbox either REFUSED with exit 78
("systemd user scopes are unavailable") or wedged the FIFO queue for
`MAX_WAIT_SECS` and exited 75 — independent adversarial-review test evidence
was blocked.

- **Container invocation → direct exec.** A wrapper run inside a container
  (`/.dockerenv`, `/run/.containerenv`, or the OCI `container=docker` env var)
  skips the semaphore and scope layers entirely and execs bun-real directly,
  logged `SANDBOX direct-exec` (best-effort: if the guard dir itself is
  read-only the log line cannot be written, and the run still proceeds — a
  disposable sandbox is already bounded by its own container cgroup). The
  fleet stations never match the markers, so the machine cap there is
  unchanged.
- **Unwritable queue dir → immediate fail-closed.** If the FIFO ticket
  cannot be created on a non-container host, the cap cannot enforce anything,
  so the wrapper refuses immediately and loudly (logged `REFUSED
  queue-unwritable` + a stderr line, exit 75) instead of the old silent
  `MAX_WAIT` wedge. It never runs a suite unbounded on a station; the guard
  refusing to run is the machine-protection contract. (A container
  invocation never reaches this branch — the SANDBOX path above already
  direct-execed.)

The station fail-closed paths are unchanged and re-proven by battery
section 18's non-container control and by section 10 (no systemd scope on a
non-container host still exits 78).

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
2. Non-bun test runners (node/vitest/jest via node, pytest, cargo test) are
   not covered. bun is the fleet-standard runner; extend the same pattern if
   another runner starts saturating.
3. `bun run test` where package.json's script says `bun test`: MEASURED
   2026-07-30 (guard.log 13:23:54Z) — bun resolves the script's `bun` via
   PATH, so it hits the wrapper and IS capped. Not a gap on bun 1.3.14.
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
5. `bun --some-flag test` (flags BEFORE the subcommand) bypasses the guard —
   the wrapper checks only `$1`. Pre-existing shape, reviewer P3-5; no such
   invocation observed in production logs. Follow-up, not a blocker.
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
  bun-real EXACTLY as given.** `battery.sh` is the 68-check regression sweep
  (env fidelity, cgroup limits, HELD validation, scope/lock lifetime, FIFO,
  fail-closed behavior, sandbox/queue degradation, and sentinel coverage,
  including the ac4558ab canary-state classification) — run it after ANY
  change to the wrapper or sentinel, on both stations.

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

- `bun run test` (in this package) runs the hermetic smoke: battery sections 16
  (sentinel canary-state classification), 17 (auto-rearm on a temp-dir COPY
  of the bin layout) and 18 (sandbox/queue degradation) against the repo
  copies. No machine guard install needed.
- `battery.sh` is the full regression sweep (sections 1-18, 68 checks) and
  must run on a station with the guard installed:

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
