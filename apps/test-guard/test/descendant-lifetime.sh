#!/usr/bin/env bash
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/test-guard-descendant.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin" "$WORK/guard"
printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=5\n' > "$WORK/guard/config"
BASH_BIN=$(command -v bash)
sed "1s|^#!/bin/bash --posix$|#!$BASH_BIN --posix|" "$HERE/bun-wrapper.sh" > "$WORK/bun-wrapper.sh"
chmod +x "$WORK/bun-wrapper.sh"

cat > "$WORK/bin/uname" <<'EOF'
#!/bin/sh
printf 'Linux\n'
EOF

cat > "$WORK/bin/systemctl" <<'EOF'
#!/bin/sh
case "$*" in
  *show-environment*) exit 0 ;;
  *"show hasna-tests.slice"*)
    printf 'Id=hasna-tests.slice\nNames=hasna-tests.slice\nLoadState=loaded\nActiveState=active\nMemoryAccounting=yes\nMemoryMax=34359738368\nMemorySwapMax=0\nTasksMax=8192\nControlGroup=/hasna-tests.slice\n'
    exit 0
    ;;
  *show*)
    scope_unit=$(cat "$TEST_GUARD_SCOPE_UNIT_FILE")
    printf 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nControlGroup=/hasna-tests.slice/%s\n' "$scope_unit"
    exit 0
    ;;
esac
exit 1
EOF

cat > "$WORK/bin/flock" <<'EOF'
#!/usr/bin/env python3
import fcntl
import os
import sys

args = [arg for arg in sys.argv[1:] if arg != "-n"]
if len(args) != 1 or not args[0].isdigit():
    raise SystemExit(64)
try:
    fcntl.flock(int(args[0]), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit(1)
except OSError:
    raise SystemExit(1)
raise SystemExit(0)
EOF

cat > "$WORK/bin/systemd-run" <<'EOF'
#!/bin/sh
scope_unit=
aggregate_slice=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --unit=*) scope_unit=${1#--unit=} ;;
    --slice=*) aggregate_slice=${1#--slice=} ;;
    --) shift; break ;;
  esac
  shift
done
[ "$aggregate_slice" = "hasna-tests.slice" ] || exit 78
[ -n "$scope_unit" ] || exit 78
printf '%s\n' "$scope_unit" > "$TEST_GUARD_SCOPE_UNIT_FILE"
scope_root="$TEST_GUARD_CGROUP_BASE/hasna-tests.slice/$scope_unit"
mkdir -p "$scope_root"
printf '0::/hasna-tests.slice/%s\n' "$scope_unit" > "$HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP"
printf 'populated 1\n' > "$scope_root/cgroup.events"
: > "$scope_root/cgroup.procs"
printf '536870912\n' > "$scope_root/memory.high"
printf '1073741824\n' > "$scope_root/memory.max"
printf '0\n' > "$scope_root/memory.swap.max"
printf '64\n' > "$scope_root/pids.max"
export TEST_GUARD_CGROUP_EVENTS="$scope_root/cgroup.events"
"$@"
rc=$?
if [ "${TEST_GUARD_RUN_KIND:-}" != first ]; then
  printf 'populated 0\n' > "$scope_root/cgroup.events"
fi
exit "$rc"
EOF

cat > "$WORK/bin/bun-real" <<'EOF'
#!/bin/sh
case "${1:-}" in
  */runtime.mjs) exec "$TEST_GUARD_BUN" "$@" ;;
esac
if [ "${TEST_GUARD_RUN_KIND:-}" = first ]; then
  touch "$TEST_GUARD_DIRECT_EXIT"
  (
    i=3
    while [ "$i" -le 64 ]; do
      eval "exec ${i}>&-" 2>/dev/null || true
      i=$((i + 1))
    done
    sleep 0.8
    printf 'populated 0\n' > "$TEST_GUARD_CGROUP_EVENTS"
    touch "$TEST_GUARD_DESCENDANT_DONE"
  ) >/dev/null 2>&1 &
  printf '%s\n' "$!" > "$TEST_GUARD_CHILD_PID"
  exit 0
fi
touch "$TEST_GUARD_SECOND_START"
exit 0
EOF

chmod +x "$WORK/bin/"*

COMMON_ENV=(
  PATH="$WORK/bin:/usr/bin:/bin"
  HASNA_TEST_GUARD_REAL="$WORK/bin/bun-real"
  HASNA_TEST_GUARD_RUNTIME="$HERE/runtime.mjs"
  HASNA_TEST_GUARD_DIR="$WORK/guard"
  HASNA_TEST_GUARD_TEST_LOCK_BACKEND=mkdir
  HASNA_TEST_GUARD_CGROUP_ROOT="$WORK/cgroup"
  HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP="$WORK/proc-self-cgroup"
  TEST_GUARD_BUN="$(command -v bun)"
  TEST_GUARD_CGROUP_BASE="$WORK/cgroup"
  TEST_GUARD_SCOPE_UNIT_FILE="$WORK/scope-unit"
  TEST_GUARD_CHILD_PID="$WORK/child.pid"
  TEST_GUARD_DIRECT_EXIT="$WORK/direct-exit"
  TEST_GUARD_DESCENDANT_DONE="$WORK/descendant-done"
  TEST_GUARD_SECOND_START="$WORK/second-start"
)

printf '0::/unassigned.scope\n' > "$WORK/proc-self-cgroup"

cat > "$WORK/first-plan.json" <<'EOF'
{"schema":"hasna.test_guard.execution_plan.v1","planId":"descendant-first","intent":"execute","runner":"bun","invocation":{"executable":"bun","argv":["test","test/one.test.ts"]},"maySpawn":true,"packages":["@hasna/test-guard"],"targetIds":["test/one.test.ts"],"selector":"explicit","packageWide":false,"workspaceWide":false,"recursive":false,"localCi":false,"lifecycleHooks":[],"dynamicDiscovery":false,"fanout":1,"descendants":[],"limits":{"memoryHighBytes":12884901888,"memoryMaxBytes":17179869184,"swapMaxBytes":0,"pidsMax":4096,"wallTimeMs":1800000}}
EOF
cat > "$WORK/second-plan.json" <<'EOF'
{"schema":"hasna.test_guard.execution_plan.v1","planId":"descendant-second","intent":"execute","runner":"bun","invocation":{"executable":"bun","argv":["test","test/two.test.ts"]},"maySpawn":true,"packages":["@hasna/test-guard"],"targetIds":["test/two.test.ts"],"selector":"explicit","packageWide":false,"workspaceWide":false,"recursive":false,"localCi":false,"lifecycleHooks":[],"dynamicDiscovery":false,"fanout":1,"descendants":[],"limits":{"memoryHighBytes":12884901888,"memoryMaxBytes":17179869184,"swapMaxBytes":0,"pidsMax":4096,"wallTimeMs":1800000}}
EOF

env "${COMMON_ENV[@]}" HASNA_TEST_GUARD_PACKAGE_ID=@hasna/test-guard HASNA_TEST_GUARD_RESOLVED_PLAN_FILE="$WORK/first-plan.json" TEST_GUARD_RUN_KIND=first "$WORK/bun-wrapper.sh" test test/one.test.ts > "$WORK/first.out" 2> "$WORK/first.err" &
first_pid=$!

deadline=$((SECONDS + 3))
while [ ! -e "$WORK/direct-exit" ] && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.02; done
if [ ! -e "$WORK/direct-exit" ]; then
  echo "FAIL descendant-lifetime: first launcher never reached direct exit"
  sed -n '1,80p' "$WORK/first.err"
  exit 1
fi

env "${COMMON_ENV[@]}" HASNA_TEST_GUARD_PACKAGE_ID=@hasna/test-guard HASNA_TEST_GUARD_RESOLVED_PLAN_FILE="$WORK/second-plan.json" TEST_GUARD_RUN_KIND=second "$WORK/bun-wrapper.sh" test test/two.test.ts > "$WORK/second.out" 2> "$WORK/second.err" &
second_pid=$!

sleep 0.2
if [ -e "$WORK/second-start" ]; then
  echo "FAIL descendant-lifetime: next invocation started while the first scope still had a descendant"
  wait "$first_pid" || true
  wait "$second_pid" || true
  exit 1
fi

wait "$first_pid"
wait "$second_pid"

[ -e "$WORK/descendant-done" ] || { echo "FAIL descendant-lifetime: descendant completion was not observed"; exit 1; }
[ -e "$WORK/second-start" ] || { echo "FAIL descendant-lifetime: queued invocation never started after scope emptiness"; exit 1; }
admission_receipt=$(grep -l '"schema":"hasna.test_guard.admission_receipt.v1"' "$WORK/guard/receipts/"*.json 2>/dev/null | head -1)
[ -n "$admission_receipt" ] || { echo "FAIL descendant-lifetime: root admission receipt was not persisted"; exit 1; }
grep -q '"schema":"hasna.test_guard.admission_receipt.v1"' "$admission_receipt" || {
  echo "FAIL descendant-lifetime: persisted admission receipt has the wrong schema"
  exit 1
}
echo "PASS descendant-lifetime: slot stayed held until the complete scope was terminal and empty"
