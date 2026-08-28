#!/bin/bash --posix
# hasna-test-guard wrapper v1 (SC-00062, 2026-07-30) — DO NOT REMOVE THIS MARKER LINE
#
# --posix IS LOAD-BEARING (incident 2026-07-30 ~15:0xZ): agent shells on this
# fleet export BASH_ENV pointing at the retired fleet cloud-runtime env file
# (path token intentionally not spelled here; the no-cloud guard forbids the
# retired runtime config pattern in packed content). A plain non-interactive
# bash sources $BASH_ENV at startup, and that chain `set -a` re-exports the
# todos/conversations/mementos API routing variables — silently REVERTING any
# `env -u VAR bun ...` unset and CLOBBERING any explicit override of those
# variables back to production cloud values before bun-real ever ran. Posix
# non-interactive bash sources nothing (verified: BASH_ENV probe 'not-sourced';
# {fd} redirection, flock, local, exec -a all verified working under --posix).
# The wrapper must pass the caller's environment through EXACTLY.
#
# Machine-wide semaphore on `bun test`: at most MAX_SLOTS test suites run
# concurrently on this machine, regardless of who spawned them (cron, loops,
# agents, interactive shells). Everything that is not `bun test` execs the real
# binary untouched. The real bun lives at bun-real in the same directory; `bun
# upgrade` running through this wrapper updates bun-real and leaves the wrapper
# in place. Full design + reinstall instructions: /home/hasna/.hasna/test-guard/README.md
#
# Why: 2026-07-30, ten cron/loop-spawned `bun test` suites drove loadavg 66.9
# on 20 cores; load-starved suites report `timed out after 5000ms` as assertion
# failures. The interactive-shell guard (bun-test-guard.zsh) never applies to
# cron-spawned work; this wrapper sits at the one path every bun invocation on
# this box resolves through.
#
# Escape hatches:
#   HASNA_TEST_GUARD_BYPASS=1  — skip the semaphore for this invocation (audited).
#   HASNA_TEST_GUARD_HELD      — set automatically for children of a suite that
#                                already holds a slot; prevents nested deadlock.
#
# Every guarded Linux suite also runs in a transient systemd user scope. The
# semaphore controls concurrency; the scope independently bounds memory, swap,
# and process count so active suites cannot turn the machine into a pager.

# HASNA_TEST_GUARD_REAL is a TEST-ONLY override (same seam class as
# HASNA_TEST_GUARD_DIR, honored for isolated testing of the guard itself):
# the battery drives temp copies of the bin layout and must never exec the
# live bun-real (review cycle 2). Production cron/agents never set it; the
# default remains the canonical fleet path.
REAL="${HASNA_TEST_GUARD_REAL:-/home/hasna/.bun/bin/bun-real}"

if [ ! -x "$REAL" ]; then
  echo "hasna-test-guard: FATAL: real bun missing at $REAL — see /home/hasna/.hasna/test-guard/README.md" >&2
  exit 127
fi

# Fast path: anything that is not a top-level `bun test`.
if [ "${1:-}" != "test" ]; then
  exec -a "$0" "$REAL" "$@"
fi

# bunx is a symlink to this file; `bunx test` runs a package named "test",
# it is not a test suite.
case "${0##*/}" in
  bunx) exec -a "$0" "$REAL" "$@" ;;
esac

# Override is for isolated testing of the guard itself; it is logged. The
# guard is a control against accidental saturation, not an adversary boundary
# (HASNA_TEST_GUARD_BYPASS already exists and is likewise logged). The
# DEFAULT guard home is resolved through @hasna/paths (XDG home migration,
# task P3.3) by resolve_guard_dir below; the exact-app override wins first.
# The resolver CLI is itself a bun binary and only runs on the guarded
# `bun test` path; a missing or unrunnable resolver falls back to the legacy
# home so the wrapper never depends on the machinery it guards.
resolve_guard_dir() {
  local resolved="" legacy
  legacy="${HOME:-/home/hasna}/.hasna/test-guard"
  if command -v paths >/dev/null 2>&1; then
    resolved=$(timeout 5 paths --app test-guard --kind state 2>/dev/null)
    [ -n "$resolved" ] || resolved=""
  fi
  # Adopt the resolver home only when the operator pointed the state kind
  # there (HASNA_STATE_HOME) or the resolved home already holds guard state —
  # an existing legacy install never becomes invisible on upgrade.
  if [ -n "$resolved" ] && { [ -n "${HASNA_STATE_HOME:-}" ] \
      || [ -d "$resolved/slots" ] || [ -f "$resolved/guard.log" ] || [ -f "$resolved/sentinel.log" ]; }; then
    printf '%s\n' "$resolved"
  else
    printf '%s\n' "$legacy"
  fi
}
GUARD_DIR="${HASNA_TEST_GUARD_DIR:-$(resolve_guard_dir)}"
MAX_SLOTS=4
MAX_WAIT_SECS=1800
# shellcheck disable=SC1091
[ -r "$GUARD_DIR/config" ] && . "$GUARD_DIR/config"

SLOT_DIR="$GUARD_DIR/slots"
mkdir -p "$SLOT_DIR" 2>/dev/null

glog() {
  printf '%s pid=%s ppid=%s %s\n' "$(date -u +%FT%TZ)" "$$" "$PPID" "$*" >> "$GUARD_DIR/guard.log" 2>/dev/null
  logger -t hasna-test-guard "pid=$$ $*" 2>/dev/null
}

has_bounded_test_scope() {
  local cgroup
  local cgroup_root
  local memory_high
  local memory_max
  local memory_swap_max
  local tasks_max
  local expected_memory_high
  local expected_memory_max
  local expected_memory_swap_max
  local expected_tasks_max

  cgroup=$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup 2>/dev/null)
  [ -n "$cgroup" ] || return 1
  cgroup_root="/sys/fs/cgroup$cgroup"
  [ -r "$cgroup_root/memory.high" ] || return 1
  [ -r "$cgroup_root/memory.max" ] || return 1
  [ -r "$cgroup_root/memory.swap.max" ] || return 1
  [ -r "$cgroup_root/pids.max" ] || return 1

  memory_high=$(cat "$cgroup_root/memory.high")
  memory_max=$(cat "$cgroup_root/memory.max")
  memory_swap_max=$(cat "$cgroup_root/memory.swap.max")
  tasks_max=$(cat "$cgroup_root/pids.max")

  expected_memory_high=$(limit_to_number "${BUN_TEST_MEMORY_HIGH:-12G}") || return 1
  expected_memory_max=$(limit_to_number "${BUN_TEST_MEMORY_MAX:-16G}") || return 1
  expected_memory_swap_max=$(limit_to_number "${BUN_TEST_MEMORY_SWAP_MAX:-0}") || return 1
  expected_tasks_max=$(limit_to_number "${BUN_TEST_TASKS_MAX:-4096}") || return 1

  case "$memory_high:$memory_max:$memory_swap_max:$tasks_max" in
    *[!0-9:]*) return 1 ;;
  esac

  [ "$memory_high" -le "$expected_memory_high" ] \
    && [ "$memory_max" -le "$expected_memory_max" ] \
    && [ "$memory_swap_max" -le "$expected_memory_swap_max" ] \
    && [ "$tasks_max" -le "$expected_tasks_max" ]
}

limit_to_number() {
  local value="$1"
  local number
  local factor
  local max_base

  case "$value" in
    *K) number=${value%K}; factor=1024; max_base=9007199254740991 ;;
    *M) number=${value%M}; factor=1048576; max_base=8796093022207 ;;
    *G) number=${value%G}; factor=1073741824; max_base=8589934591 ;;
    *T) number=${value%T}; factor=1099511627776; max_base=8388607 ;;
    *) number=$value; factor=1; max_base=9223372036854775807 ;;
  esac

  case "$number" in
    ""|*[!0-9]*) return 1 ;;
  esac

  # Bash arithmetic interprets a leading zero as octal. Normalize it away,
  # then reject values that would overflow signed 64-bit arithmetic.
  while [ "${number#0}" != "$number" ]; do number=${number#0}; done
  [ -n "$number" ] || number=0
  if [ "${#number}" -gt "${#max_base}" ]; then
    return 1
  fi
  if [ "${#number}" -eq "${#max_base}" ]; then
    local index=0
    local number_digit
    local max_digit
    while [ "$index" -lt "${#number}" ]; do
      number_digit=${number:index:1}
      max_digit=${max_base:index:1}
      if [ "$number_digit" -gt "$max_digit" ]; then
        return 1
      fi
      if [ "$number_digit" -lt "$max_digit" ]; then
        break
      fi
      index=$((index + 1))
    done
  fi

  printf '%s\n' "$((number * factor))"
}

# Container/sandbox detection (I38-00746). The machine-wide cap exists to
# protect the shared fleet station; codewith sandboxes (e2b Docker
# containers) carry the fleet wrapper install but have no systemd user scope
# and a read-only guard dir (image layer), so the cap machinery cannot
# operate there and refusing (78) or wedging the FIFO queue (75) blocks
# legitimate independent-review test evidence. A container is bounded by its
# own container cgroup, so a container invocation degrades to a direct,
# logged exec of bun-real. Markers: the OCI container marker files and the
# `container` env var set by container runtimes; absent on the fleet hosts.
is_container() {
  [ -f /.dockerenv ] || [ -f /run/.containerenv ] || [ "${container:-}" = "docker" ]
}

CALLER_XDG_RUNTIME_DIR_SET=${XDG_RUNTIME_DIR+x}
CALLER_XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR-}
CALLER_DBUS_SESSION_BUS_ADDRESS_SET=${DBUS_SESSION_BUS_ADDRESS+x}
CALLER_DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS-}
SYSTEMD_RUN_XDG_RUNTIME_DIR=""

prepare_systemd_user_manager() {
  local uid
  local candidate
  local mode

  if systemctl --user show-environment >/dev/null 2>&1; then
    return 0
  fi

  uid=$(id -u 2>/dev/null) || return 1
  candidate="/run/user/$uid"
  [ -d "$candidate" ] || return 1
  [ -O "$candidate" ] || return 1
  [ -w "$candidate" ] || return 1
  mode=$(stat -c %a "$candidate" 2>/dev/null) || return 1
  [ "$mode" = "700" ] || return 1
  env -u DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR="$candidate" \
    systemctl --user show-environment >/dev/null 2>&1 || return 1
  SYSTEMD_RUN_XDG_RUNTIME_DIR=$candidate
  return 0
}

run_transient_scope() {
  if [ -n "$SYSTEMD_RUN_XDG_RUNTIME_DIR" ]; then
    env -u DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR="$SYSTEMD_RUN_XDG_RUNTIME_DIR" \
      systemd-run --user --scope --quiet --collect \
      -p MemoryAccounting=yes \
      -p "MemoryHigh=${BUN_TEST_MEMORY_HIGH:-12G}" \
      -p "MemoryMax=${BUN_TEST_MEMORY_MAX:-16G}" \
      -p "MemorySwapMax=${BUN_TEST_MEMORY_SWAP_MAX:-0}" \
      -p "TasksMax=${BUN_TEST_TASKS_MAX:-4096}" \
      -- "$@"
  else
    systemd-run --user --scope --quiet --collect \
      -p MemoryAccounting=yes \
      -p "MemoryHigh=${BUN_TEST_MEMORY_HIGH:-12G}" \
      -p "MemoryMax=${BUN_TEST_MEMORY_MAX:-16G}" \
      -p "MemorySwapMax=${BUN_TEST_MEMORY_SWAP_MAX:-0}" \
      -p "TasksMax=${BUN_TEST_TASKS_MAX:-4096}" \
      -- "$@"
  fi
}

if [ -n "${HASNA_TEST_GUARD_HELD:-}" ]; then
  if has_bounded_test_scope; then
    exec -a "$0" "$REAL" "$@"
  fi
  glog "STALE-HELD re-entering guard cwd=$PWD argv=$*"
  unset HASNA_TEST_GUARD_HELD HASNA_TEST_GUARD_SLOT
fi

exec_guarded_test() {
  export HASNA_TEST_GUARD_HELD=1

  if has_bounded_test_scope; then
    exec -a "$0" "$REAL" "$@"
  fi

  if [ "$(uname -s)" != "Linux" ] \
    || ! command -v systemd-run >/dev/null 2>&1 \
    || ! prepare_systemd_user_manager; then
    glog "REFUSED no-systemd-user-scope cwd=$PWD argv=$*"
    echo "hasna-test-guard: refusing unscoped bun test; systemd user scopes are unavailable" >&2
    exit 78
  fi

  if [ -n "$CALLER_XDG_RUNTIME_DIR_SET" ] \
    && [ -n "$CALLER_DBUS_SESSION_BUS_ADDRESS_SET" ]; then
    run_transient_scope env \
      XDG_RUNTIME_DIR="$CALLER_XDG_RUNTIME_DIR" \
      DBUS_SESSION_BUS_ADDRESS="$CALLER_DBUS_SESSION_BUS_ADDRESS" \
      "$REAL" "$@"
  elif [ -n "$CALLER_XDG_RUNTIME_DIR_SET" ]; then
    run_transient_scope env -u DBUS_SESSION_BUS_ADDRESS \
      XDG_RUNTIME_DIR="$CALLER_XDG_RUNTIME_DIR" "$REAL" "$@"
  elif [ -n "$CALLER_DBUS_SESSION_BUS_ADDRESS_SET" ]; then
    run_transient_scope env -u XDG_RUNTIME_DIR \
      DBUS_SESSION_BUS_ADDRESS="$CALLER_DBUS_SESSION_BUS_ADDRESS" \
      "$REAL" "$@"
  else
    run_transient_scope env -u XDG_RUNTIME_DIR -u DBUS_SESSION_BUS_ADDRESS \
      "$REAL" "$@"
  fi
  exit $?
}

if [ -n "${HASNA_TEST_GUARD_BYPASS:-}" ]; then
  glog "BYPASS cwd=$PWD argv=$*"
  exec -a "$0" "$REAL" "$@"
fi

# --- Container/sandbox degradation (I38-00746) ------------------------------
# codewith sandboxes carry the fleet wrapper install but have no systemd user
# scope and a read-only guard dir, so the semaphore machinery cannot operate
# there: the scope preflight REFUSED (78) and the FIFO queue wedged to
# MAX_WAIT (75) — every `bun test` inside a sandbox died and independent
# review test evidence was blocked. A sandbox is disposable and already
# bounded by its own container cgroup, so a container invocation degrades to
# a direct, logged exec of bun-real. The fleet stations are bare hosts and
# never match is_container, so the machine cap there is unchanged.
if is_container; then
  glog "SANDBOX direct-exec cwd=$PWD argv=$*"
  exec -a "$0" "$REAL" "$@"
fi

# --- FIFO queue (added 2026-07-30 after production starvation was measured:
# a suite waited 1330s while later arrivals took freed slots with waited=0s —
# the bare probe loop favors whoever probes at the instant of release).
# Each waiter files a ticket named <ns-timestamp>.<pid>; only the waiter whose
# ticket sorts first may probe the slots. Dead owners' tickets are reaped by
# liveness check; a hard staleness cap bounds any stuck head.
QUEUE_DIR="$GUARD_DIR/queue"
mkdir -p "$QUEUE_DIR" 2>/dev/null

TICKET="$(date +%s%N).$$"
if ! : > "$QUEUE_DIR/$TICKET" 2>/dev/null; then
  # The FIFO cannot function, so the cap cannot be enforced: fail closed
  # IMMEDIATELY and loudly instead of the silent MAX_WAIT wedge (the old
  # behavior spun 1800s and then exited 75 anyway). This branch is only
  # reachable on a non-container host — a container invocation was already
  # direct-execed by the SANDBOX path above — so it must never run a suite
  # unbounded; the cap refusing to run is the machine-protection contract.
  glog "REFUSED queue-unwritable cwd=$PWD argv=$*"
  echo "hasna-test-guard: guard queue unwritable at $QUEUE_DIR — machine cap cannot enforce; refusing to run unbounded (fail-closed). Fix the guard dir permissions." >&2
  exit 75
fi
trap 'rm -f "$QUEUE_DIR/$TICKET"' EXIT

# try_slots must be CALLED WITH the script's "$@" — inside a bash function,
# "$@" is the function's own arg list. First deployment execed bare `bun`
# (help, exit 0) for every queued suite: a silent false-green, caught by the
# FIFO positive control showing acquired argv= empty and 0s suite runtimes.
try_slots() {
  local i=0
  while [ "$i" -lt "$MAX_SLOTS" ]; do
    # NOTE: no redirection on this exec — `exec {fd}>>file 2>/dev/null` would
    # permanently null the shell's (and the exec'd suite's) stderr. Caught by
    # positive control 2026-07-30: suites lost their entire test output.
    if exec {fd}>>"$SLOT_DIR/slot-$i"; then
      if flock -n "$fd" 2>/dev/null; then
        rm -f "$QUEUE_DIR/$TICKET"
        trap - EXIT
        glog "acquired slot=$i waited=$((SECONDS-start))s cwd=$PWD argv=$*"
        export HASNA_TEST_GUARD_SLOT="$i"
        # fd stays open across exec: the flock is held for the lifetime of the
        # systemd-run scope launcher and releases when the suite exits.
        exec_guarded_test "$@"
      fi
      exec {fd}>&-
    fi
    i=$((i+1))
  done
  return 1
}

start=$SECONDS
notified=""
now_ns() { date +%s%N; }
while :; do
  # Reap tickets whose owner is dead or whose ticket exceeds the staleness cap
  # (MAX_WAIT + 120s) — a stuck head must never wedge the whole queue. Do not
  # infer waiter identity from cmdline: valid relative/alternate wrapper paths
  # otherwise get mistaken for recycled PIDs and perpetually requeued.
  stale_before=$(( $(now_ns) - (MAX_WAIT_SECS + 120) * 1000000000 ))
  for t in "$QUEUE_DIR"/*; do
    [ -e "$t" ] || continue
    tn=${t##*/}; tpid=${tn##*.}; tts=${tn%%.*}
    if [ ! -d "/proc/$tpid" ] \
       || [ "$tts" -lt "$stale_before" ] 2>/dev/null; then
      [ "$tn" != "$TICKET" ] && rm -f "$t"
    fi
  done
  # Self-heal: if our ticket was reaped or lost, refile (keeps original start
  # for the timeout but re-queues at the tail — correctness over position).
  # mkdir -p first: reviewer P2-1 measured that a deleted queue/ dir otherwise
  # makes every refile fail and the waiter rc=75s past a free slot.
  if [ ! -e "$QUEUE_DIR/$TICKET" ]; then
    mkdir -p "$QUEUE_DIR" 2>/dev/null
    TICKET="$(date +%s%N).$$"
    : > "$QUEUE_DIR/$TICKET"
    trap 'rm -f "$QUEUE_DIR/$TICKET"' EXIT
  fi
  head_ticket=$(ls "$QUEUE_DIR" 2>/dev/null | sort | head -1)
  if [ "$head_ticket" = "$TICKET" ]; then
    try_slots "$@"
    sleep 1
  else
    sleep 3
  fi
  if [ -z "$notified" ]; then
    glog "waiting all-slots-busy ticket=$TICKET cwd=$PWD argv=$*"
    echo "hasna-test-guard: all $MAX_SLOTS machine-wide test slots busy; queueing FIFO (max ${MAX_WAIT_SECS}s)..." >&2
    notified=1
  fi
  if [ $((SECONDS-start)) -ge "$MAX_WAIT_SECS" ]; then
    glog "TIMEOUT waited=$((SECONDS-start))s ticket=$TICKET cwd=$PWD argv=$*"
    echo "hasna-test-guard: all $MAX_SLOTS test slots busy for ${MAX_WAIT_SECS}s; refusing to run unbounded. This is the machine-wide test-concurrency cap (SC-00062), NOT a failure of the code under test. Holders: see fuser $SLOT_DIR/slot-* and $GUARD_DIR/guard.log" >&2
    exit 75
  fi
done
