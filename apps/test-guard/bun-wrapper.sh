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
# Parent controls:
#   HASNA_TEST_GUARD_BYPASS=1  — refuses for focused local execution; it cannot
#                                replace admission or allocation evidence.
#   HASNA_TEST_GUARD_HELD      — set for children of an admitted suite; accepted
#                                only with a valid parent receipt and cgroup.
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

# bunx is a symlink to this file; `bunx test` runs a package named "test",
# it is not a test suite.
case "${0##*/}" in
  bunx) exec -a "$0" "$REAL" "$@" ;;
esac

# Override is for isolated testing of the guard itself; it is logged. The
# guard is a control against accidental saturation, not an adversary boundary
# (HASNA_TEST_GUARD_BYPASS already exists and is likewise logged).
GUARD_DIR="${HASNA_TEST_GUARD_DIR:-/home/hasna/.hasna/test-guard}"
WRAPPER_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd) || WRAPPER_DIR=""
if [ -n "${HASNA_TEST_GUARD_RUNTIME:-}" ]; then
  GUARD_RUNTIME=$HASNA_TEST_GUARD_RUNTIME
elif [ -n "$WRAPPER_DIR" ] && [ -r "$WRAPPER_DIR/runtime.mjs" ]; then
  GUARD_RUNTIME="$WRAPPER_DIR/runtime.mjs"
else
  GUARD_RUNTIME="$GUARD_DIR/runtime.mjs"
fi
readonly AGGREGATE_TEST_SLICE="hasna-tests.slice"

# The wrapper only intercepts. The package-owned runtime resolves the complete
# execution-plan shape and classifies it; the wrapper never decides safety from
# a command name or argument position. Exit 10 is the sole local-focused admit
# signal. Missing runtime or any other result fails closed before a child starts.
if [ ! -r "$GUARD_RUNTIME" ]; then
  echo "hasna-test-guard: refusing invocation; resolved-plan runtime missing at $GUARD_RUNTIME" >&2
  exit 78
fi
if [ -n "${HASNA_TEST_GUARD_HELD:-}" ]; then
  mkdir -p "$GUARD_DIR/receipts" 2>/dev/null || exit 78
  HASNA_TEST_GUARD_CHILD_ADMISSION_RECEIPT_FILE="$GUARD_DIR/receipts/child-$$.json"
  export HASNA_TEST_GUARD_CHILD_ADMISSION_RECEIPT_FILE
fi
"$REAL" "$GUARD_RUNTIME" intercept "$@"
INTERCEPT_RC=$?
case "$INTERCEPT_RC" in
  0) exec -a "$0" "$REAL" "$@" ;;
  10) ;;
  78) exit 78 ;;
  *)
    echo "hasna-test-guard: refusing invocation; resolved-plan classification failed rc=$INTERCEPT_RC" >&2
    exit 78
    ;;
esac

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
  local cgroup_file
  local cgroup_root
  local memory_high
  local memory_max
  local memory_swap_max
  local tasks_max
  local expected_memory_high
  local expected_memory_max
  local expected_memory_swap_max
  local expected_tasks_max

  cgroup_file=/proc/self/cgroup
  if [ "${HASNA_TEST_GUARD_TEST_LOCK_BACKEND:-}" = "mkdir" ] \
    && [ -n "${HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP:-}" ]; then
    cgroup_file=$HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP
  fi
  cgroup=$(awk -F: '$1 == "0" { print $3 }' "$cgroup_file" 2>/dev/null)
  [ -n "$cgroup" ] || return 1
  cgroup_root="${HASNA_TEST_GUARD_CGROUP_ROOT:-/sys/fs/cgroup}$cgroup"
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
  local scope_unit=$1
  shift
  if [ -n "$SYSTEMD_RUN_XDG_RUNTIME_DIR" ]; then
    env -u DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR="$SYSTEMD_RUN_XDG_RUNTIME_DIR" \
      systemd-run --user --scope --quiet --unit="$scope_unit" --slice="$AGGREGATE_TEST_SLICE" \
      -p MemoryAccounting=yes \
      -p "MemoryHigh=${BUN_TEST_MEMORY_HIGH:-12G}" \
      -p "MemoryMax=${BUN_TEST_MEMORY_MAX:-16G}" \
      -p "MemorySwapMax=${BUN_TEST_MEMORY_SWAP_MAX:-0}" \
      -p "TasksMax=${BUN_TEST_TASKS_MAX:-4096}" \
      -- "$@"
  else
    systemd-run --user --scope --quiet --unit="$scope_unit" --slice="$AGGREGATE_TEST_SLICE" \
      -p MemoryAccounting=yes \
      -p "MemoryHigh=${BUN_TEST_MEMORY_HIGH:-12G}" \
      -p "MemoryMax=${BUN_TEST_MEMORY_MAX:-16G}" \
      -p "MemorySwapMax=${BUN_TEST_MEMORY_SWAP_MAX:-0}" \
      -p "TasksMax=${BUN_TEST_TASKS_MAX:-4096}" \
      -- "$@"
  fi
}

run_user_systemctl() {
  if [ -n "$SYSTEMD_RUN_XDG_RUNTIME_DIR" ]; then
    env -u DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR="$SYSTEMD_RUN_XDG_RUNTIME_DIR" \
      systemctl --user "$@"
  else
    systemctl --user "$@"
  fi
}

verify_aggregate_controller() {
  local raw_file
  local receipt_file
  local controller_control_group

  mkdir -p "$GUARD_DIR/receipts" 2>/dev/null || return 1
  raw_file=$(mktemp "$GUARD_DIR/receipts/aggregate-controller.XXXXXX.raw") || return 1
  chmod 600 "$raw_file" 2>/dev/null || { rm -f "$raw_file"; return 1; }
  receipt_file="${raw_file%.raw}.json"
  if ! run_user_systemctl show "$AGGREGATE_TEST_SLICE" \
    --property=Id --property=Names --property=LoadState --property=ActiveState \
    --property=MemoryAccounting --property=MemoryMax --property=MemorySwapMax \
    --property=TasksMax --property=ControlGroup --no-pager >"$raw_file" 2>/dev/null; then
    rm -f "$raw_file"
    return 1
  fi
  if ! controller_control_group=$("$REAL" "$GUARD_RUNTIME" verify-controller \
    "$AGGREGATE_TEST_SLICE" "$raw_file" "$receipt_file"); then
    rm -f "$raw_file" "$receipt_file"
    return 1
  fi
  case "$controller_control_group" in
    /*/"$AGGREGATE_TEST_SLICE"|/"$AGGREGATE_TEST_SLICE") ;;
    *) rm -f "$raw_file" "$receipt_file"; return 1 ;;
  esac
  rm -f "$raw_file"
  AGGREGATE_CONTROLLER_RECEIPT_FILE=$receipt_file
  AGGREGATE_CONTROLLER_CONTROL_GROUP=$controller_control_group
  return 0
}

prepare_verified_aggregate_controller() {
  [ "$(uname -s)" = "Linux" ] \
    && command -v systemd-run >/dev/null 2>&1 \
    && command -v systemctl >/dev/null 2>&1 \
    && prepare_systemd_user_manager \
    && verify_aggregate_controller
}

wait_for_scope_terminal_empty() {
  local scope_unit=$1
  local state
  local load_state
  local active_state
  local sub_state
  local control_group
  local cgroup_root
  local populated
  local ambiguity_logged=""
  local cgroup_base="${HASNA_TEST_GUARD_CGROUP_ROOT:-/sys/fs/cgroup}"

  while :; do
    state=$(run_user_systemctl show "$scope_unit" \
      --property=LoadState --property=ActiveState --property=SubState --property=ControlGroup \
      --no-pager 2>/dev/null) || state=""
    if [ "$(printf '%s\n' "$state" | grep -c '^LoadState=')" = "1" ] \
      && [ "$(printf '%s\n' "$state" | grep -c '^ActiveState=')" = "1" ] \
      && [ "$(printf '%s\n' "$state" | grep -c '^SubState=')" = "1" ] \
      && [ "$(printf '%s\n' "$state" | grep -c '^ControlGroup=')" = "1" ]; then
      load_state=$(printf '%s\n' "$state" | sed -n 's/^LoadState=//p')
      active_state=$(printf '%s\n' "$state" | sed -n 's/^ActiveState=//p')
      sub_state=$(printf '%s\n' "$state" | sed -n 's/^SubState=//p')
      control_group=$(printf '%s\n' "$state" | sed -n 's/^ControlGroup=//p')
      case "$control_group" in
        /*) ;;
        *) control_group="" ;;
      esac
      case "$control_group" in
        /|*/../*|*/..|*//* ) control_group="" ;;
      esac

      if [ "$load_state" = "loaded" ] \
        && [ "$control_group" = "$AGGREGATE_CONTROLLER_CONTROL_GROUP/$scope_unit" ]; then
        cgroup_root="$cgroup_base$control_group"
        if [ -r "$cgroup_root/cgroup.events" ] && [ -r "$cgroup_root/cgroup.procs" ]; then
          populated=$(sed -n 's/^populated[[:space:]][[:space:]]*\([01]\)$/\1/p' "$cgroup_root/cgroup.events")
          if [ "$populated" = "0" ] \
            && case "$active_state:$sub_state" in inactive:dead|failed:failed|failed:dead) true ;; *) false ;; esac \
            && [ ! -s "$cgroup_root/cgroup.procs" ]; then
            return 0
          fi
        fi
      fi
    fi
    if [ -z "$ambiguity_logged" ]; then
      glog "holding terminal-state-unverified unit=$scope_unit cwd=$PWD"
      ambiguity_logged=1
    fi
    sleep 1
  done
}

if ! prepare_verified_aggregate_controller; then
  glog "REFUSED aggregate-controller-unverified unit=$AGGREGATE_TEST_SLICE cwd=$PWD argv=$*"
  echo "hasna-test-guard: refusing local execution; aggregate controller $AGGREGATE_TEST_SLICE is missing, inactive, mismatched, unlimited, or unverifiable" >&2
  exit 78
fi

if [ -n "${HASNA_TEST_GUARD_HELD:-}" ]; then
  current_cgroup_file=/proc/self/cgroup
  if [ "${HASNA_TEST_GUARD_TEST_LOCK_BACKEND:-}" = "mkdir" ] \
    && [ -n "${HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP:-}" ]; then
    current_cgroup_file=$HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP
  fi
  current_cgroup=$(awk -F: '$1 == "0" { print $3 }' "$current_cgroup_file" 2>/dev/null)
  if [ -n "${HASNA_TEST_GUARD_ALLOCATION_ID:-}" ] \
    && [ -n "${HASNA_TEST_GUARD_LEASE_ID:-}" ] \
    && [ -n "${HASNA_TEST_GUARD_CGROUP_ID:-}" ] \
    && [ -n "$current_cgroup" ] \
    && case "$current_cgroup" in *"$HASNA_TEST_GUARD_CGROUP_ID"*) true ;; *) false ;; esac \
    && has_bounded_test_scope \
    && "$REAL" "$GUARD_RUNTIME" child-admit \
      "$AGGREGATE_CONTROLLER_RECEIPT_FILE" "$HASNA_TEST_GUARD_CHILD_ADMISSION_RECEIPT_FILE" \
    && [ -s "${HASNA_TEST_GUARD_CHILD_ADMISSION_RECEIPT_FILE:-}" ]; then
    HASNA_TEST_GUARD_PARENT_ADMISSION_RECEIPT_FILE=$HASNA_TEST_GUARD_CHILD_ADMISSION_RECEIPT_FILE
    export HASNA_TEST_GUARD_PARENT_ADMISSION_RECEIPT_FILE
    exec -a "$0" "$REAL" "$@"
  fi
  glog "REFUSED invalid-parent-evidence cwd=$PWD argv=$*"
  echo "hasna-test-guard: refusing child before spawn; parent allocation evidence is missing or mismatched" >&2
  exit 78
fi

exec_guarded_test() {
  local scope_unit=$1
  shift
  local direct_rc
  local admission_receipt="$GUARD_DIR/receipts/$scope_unit.json"
  mkdir -p "$GUARD_DIR/receipts" 2>/dev/null || exit 78

  if ! prepare_verified_aggregate_controller; then
    glog "REFUSED aggregate-controller-stale unit=$AGGREGATE_TEST_SLICE cwd=$PWD argv=$*"
    echo "hasna-test-guard: refusing local execution; aggregate controller verification did not survive allocation" >&2
    exit 78
  fi

  if [ -n "$CALLER_XDG_RUNTIME_DIR_SET" ] \
    && [ -n "$CALLER_DBUS_SESSION_BUS_ADDRESS_SET" ]; then
    run_transient_scope "$scope_unit" env \
      XDG_RUNTIME_DIR="$CALLER_XDG_RUNTIME_DIR" \
      DBUS_SESSION_BUS_ADDRESS="$CALLER_DBUS_SESSION_BUS_ADDRESS" \
      "$REAL" "$GUARD_RUNTIME" launch "$scope_unit" "$AGGREGATE_CONTROLLER_RECEIPT_FILE" "$admission_receipt" -- "$REAL" "$@"
  elif [ -n "$CALLER_XDG_RUNTIME_DIR_SET" ]; then
    run_transient_scope "$scope_unit" env -u DBUS_SESSION_BUS_ADDRESS \
      XDG_RUNTIME_DIR="$CALLER_XDG_RUNTIME_DIR" \
      "$REAL" "$GUARD_RUNTIME" launch "$scope_unit" "$AGGREGATE_CONTROLLER_RECEIPT_FILE" "$admission_receipt" -- "$REAL" "$@"
  elif [ -n "$CALLER_DBUS_SESSION_BUS_ADDRESS_SET" ]; then
    run_transient_scope "$scope_unit" env -u XDG_RUNTIME_DIR \
      DBUS_SESSION_BUS_ADDRESS="$CALLER_DBUS_SESSION_BUS_ADDRESS" \
      "$REAL" "$GUARD_RUNTIME" launch "$scope_unit" "$AGGREGATE_CONTROLLER_RECEIPT_FILE" "$admission_receipt" -- "$REAL" "$@"
  else
    run_transient_scope "$scope_unit" env -u XDG_RUNTIME_DIR -u DBUS_SESSION_BUS_ADDRESS \
      "$REAL" "$GUARD_RUNTIME" launch "$scope_unit" "$AGGREGATE_CONTROLLER_RECEIPT_FILE" "$admission_receipt" -- "$REAL" "$@"
  fi
  direct_rc=$?
  wait_for_scope_terminal_empty "$scope_unit"
  glog "terminal unit=$scope_unit direct_rc=$direct_rc active=inactive populated=0 release=1 cwd=$PWD argv=$*"
  exit "$direct_rc"
}

if [ -n "${HASNA_TEST_GUARD_BYPASS:-}" ]; then
  glog "REFUSED bypass-local-allocation cwd=$PWD argv=$*"
  echo "hasna-test-guard: refusing local execution; bypass cannot replace verified admission and scope accounting" >&2
  exit 78
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
: > "$QUEUE_DIR/$TICKET"
trap 'rm -f "$QUEUE_DIR/$TICKET"' EXIT

# try_slots must be CALLED WITH the script's "$@" — inside a bash function,
# "$@" is the function's own arg list. First deployment execed bare `bun`
# (help, exit 0) for every queued suite: a silent false-green, caught by the
# FIFO positive control showing acquired argv= empty and 0s suite runtimes.
try_slots() {
  local i=0
  while [ "$i" -lt "$MAX_SLOTS" ]; do
    # Hermetic descendant-lifetime regression seam. Production never sets it;
    # mkdir ownership models one exclusive slot on hosts without flock(1).
    if [ "${HASNA_TEST_GUARD_TEST_LOCK_BACKEND:-}" = "mkdir" ]; then
      test_lock="$SLOT_DIR/slot-$i.lock"
      if mkdir "$test_lock" 2>/dev/null; then
        trap 'rmdir "$test_lock" 2>/dev/null; rm -f "$QUEUE_DIR/$TICKET"' EXIT
        rm -f "$QUEUE_DIR/$TICKET"
        glog "acquired slot=$i waited=$((SECONDS-start))s cwd=$PWD argv=$*"
        export HASNA_TEST_GUARD_SLOT="$i"
        scope_unit="hasna-test-guard-${TICKET//./-}.scope"
        exec_guarded_test "$scope_unit" "$@"
      fi
      i=$((i+1))
      continue
    fi
    # NOTE: no redirection on this exec — `exec {fd}>>file 2>/dev/null` would
    # permanently null the shell's (and the exec'd suite's) stderr. Caught by
    # positive control 2026-07-30: suites lost their entire test output.
    if exec {fd}>>"$SLOT_DIR/slot-$i"; then
      if flock -n "$fd" 2>/dev/null; then
        rm -f "$QUEUE_DIR/$TICKET"
        trap - EXIT
        glog "acquired slot=$i waited=$((SECONDS-start))s cwd=$PWD argv=$*"
        export HASNA_TEST_GUARD_SLOT="$i"
        scope_unit="hasna-test-guard-${TICKET//./-}.scope"
        # The wrapper process retains the flock after the direct launcher exits.
        # It releases only after terminal state and recursive cgroup emptiness
        # are both observed for the named scope.
        exec_guarded_test "$scope_unit" "$@"
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
