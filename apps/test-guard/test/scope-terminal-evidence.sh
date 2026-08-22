#!/usr/bin/env bash
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/test-guard-terminal.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/bin"
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
    case "${TEST_GUARD_SCOPE_OBSERVATION:-terminal-present}" in
      terminal-present)
        printf 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nControlGroup=/hasna-tests.slice/%s\n' "$scope_unit"
        exit 0
        ;;
      collected)
        printf 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nControlGroup=\n'
        exit 4
        ;;
      ambiguous)
        printf 'LoadState=not-found\nActiveState=activating\nSubState=start\nControlGroup=\n'
        exit 4
        ;;
    esac
    ;;
esac
exit 1
EOF

cat > "$WORK/bin/systemd-run" <<'EOF'
#!/bin/sh
if [ "${TEST_GUARD_SYSTEMD_RUN_MODE:-normal}" = fail-before-scope ]; then
  exit 69
fi
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
printf 'populated 1\n' > "$scope_root/cgroup.events"
: > "$scope_root/cgroup.procs"
printf '0::/hasna-tests.slice/%s\n' "$scope_unit" > "$HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP"
"$@"
rc=$?
case "${TEST_GUARD_SCOPE_OBSERVATION:-terminal-present}" in
  terminal-present) printf 'populated 0\n' > "$scope_root/cgroup.events" ;;
  collected|ambiguous) rm -rf "$scope_root" ;;
esac
exit "$rc"
EOF

cat > "$WORK/bin/bun-real" <<'EOF'
#!/bin/sh
case "${1:-}" in
  */runtime.mjs) exec "$TEST_GUARD_BUN" "$@" ;;
esac
touch "$TEST_GUARD_SENTINEL"
exit 0
EOF
chmod +x "$WORK/bin/"*

cat > "$WORK/resolved-plan.json" <<'EOF'
{"schema":"hasna.test_guard.execution_plan.v1","planId":"scope-terminal-evidence","intent":"execute","runner":"bun","invocation":{"executable":"bun","argv":["test","test/scope-terminal-evidence.test.ts"]},"maySpawn":true,"packages":["@hasna/test-guard"],"targetIds":["test/scope-terminal-evidence.test.ts"],"selector":"explicit","packageWide":false,"workspaceWide":false,"recursive":false,"localCi":false,"lifecycleHooks":[],"dynamicDiscovery":false,"fanout":1,"descendants":[],"limits":{"memoryHighBytes":536870912,"memoryMaxBytes":1073741824,"swapMaxBytes":0,"pidsMax":64,"wallTimeMs":30000}}
EOF

run_wrapper() {
  local case_root=$1
  local run_mode=$2
  local observation=$3
  mkdir -p "$case_root/guard" "$case_root/cgroup"
  printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=2\n' > "$case_root/guard/config"
  printf '0::/unassigned.scope\n' > "$case_root/proc-self-cgroup"
  rm -f "$case_root/sentinel" "$case_root/scope-unit"
  set +e
  env \
    PATH="$WORK/bin:/usr/bin:/bin" \
    HASNA_TEST_GUARD_REAL="$WORK/bin/bun-real" \
    HASNA_TEST_GUARD_RUNTIME="$HERE/runtime.mjs" \
    HASNA_TEST_GUARD_DIR="$case_root/guard" \
    HASNA_TEST_GUARD_TEST_LOCK_BACKEND=mkdir \
    HASNA_TEST_GUARD_CGROUP_ROOT="$case_root/cgroup" \
    HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP="$case_root/proc-self-cgroup" \
    HASNA_TEST_GUARD_PACKAGE_ID=@hasna/test-guard \
    HASNA_TEST_GUARD_RESOLVED_PLAN_FILE="$WORK/resolved-plan.json" \
    TEST_GUARD_BUN="$(command -v bun)" \
    TEST_GUARD_CGROUP_BASE="$case_root/cgroup" \
    TEST_GUARD_SCOPE_UNIT_FILE="$case_root/scope-unit" \
    TEST_GUARD_SENTINEL="$case_root/sentinel" \
    TEST_GUARD_SYSTEMD_RUN_MODE="$run_mode" \
    TEST_GUARD_SCOPE_OBSERVATION="$observation" \
    "$WORK/bun-wrapper.sh" test test/scope-terminal-evidence.test.ts \
    > "$case_root/stdout" 2> "$case_root/stderr"
  CASE_RC=$?
  set -e
}

no_admit_root="$WORK/no-admit"
run_wrapper "$no_admit_root" fail-before-scope terminal-present
[ "$CASE_RC" -eq 69 ] || { echo "FAIL no-admission-release: systemd-run failure rc=$CASE_RC"; exit 1; }
[ ! -e "$no_admit_root/sentinel" ] || { echo "FAIL no-admission-release: test sentinel spawned"; exit 1; }
run_wrapper "$no_admit_root" normal terminal-present
[ "$CASE_RC" -eq 0 ] || { echo "FAIL no-admission-release: follow-up invocation rc=$CASE_RC"; exit 1; }
[ -e "$no_admit_root/sentinel" ] || { echo "FAIL no-admission-release: sole slot stayed consumed"; exit 1; }
echo "PASS no-admission-release: pre-scope systemd-run failure spawned no test and did not consume the sole slot"

collected_root="$WORK/collected"
run_wrapper "$collected_root" normal collected
[ "$CASE_RC" -eq 0 ] || { echo "FAIL collected-terminal-release: rc=$CASE_RC"; exit 1; }
[ -e "$collected_root/sentinel" ] || { echo "FAIL collected-terminal-release: admitted test did not spawn"; exit 1; }
echo "PASS collected-terminal-release: exact admitted scope released after not-found/inactive/dead and cgroup removal"

ambiguous_root="$WORK/ambiguous"
mkdir -p "$ambiguous_root/guard" "$ambiguous_root/cgroup"
printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=2\n' > "$ambiguous_root/guard/config"
printf '0::/unassigned.scope\n' > "$ambiguous_root/proc-self-cgroup"
env \
  PATH="$WORK/bin:/usr/bin:/bin" \
  HASNA_TEST_GUARD_REAL="$WORK/bin/bun-real" \
  HASNA_TEST_GUARD_RUNTIME="$HERE/runtime.mjs" \
  HASNA_TEST_GUARD_DIR="$ambiguous_root/guard" \
  HASNA_TEST_GUARD_TEST_LOCK_BACKEND=mkdir \
  HASNA_TEST_GUARD_CGROUP_ROOT="$ambiguous_root/cgroup" \
  HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP="$ambiguous_root/proc-self-cgroup" \
  HASNA_TEST_GUARD_PACKAGE_ID=@hasna/test-guard \
  HASNA_TEST_GUARD_RESOLVED_PLAN_FILE="$WORK/resolved-plan.json" \
  TEST_GUARD_BUN="$(command -v bun)" \
  TEST_GUARD_CGROUP_BASE="$ambiguous_root/cgroup" \
  TEST_GUARD_SCOPE_UNIT_FILE="$ambiguous_root/scope-unit" \
  TEST_GUARD_SENTINEL="$ambiguous_root/sentinel" \
  TEST_GUARD_SYSTEMD_RUN_MODE=normal \
  TEST_GUARD_SCOPE_OBSERVATION=ambiguous \
  "$WORK/bun-wrapper.sh" test test/scope-terminal-evidence.test.ts \
  > "$ambiguous_root/stdout" 2> "$ambiguous_root/stderr" &
ambiguous_pid=$!
deadline=$((SECONDS + 3))
while [ ! -e "$ambiguous_root/sentinel" ] && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.02; done
[ -e "$ambiguous_root/sentinel" ] || { echo "FAIL ambiguous-terminal-hold: admitted test did not spawn"; kill "$ambiguous_pid" 2>/dev/null || true; exit 1; }
sleep 0.2
kill -0 "$ambiguous_pid" 2>/dev/null || { echo "FAIL ambiguous-terminal-hold: ambiguous evidence released the slot"; exit 1; }
[ -d "$ambiguous_root/guard/slots/slot-0.lock" ] || { echo "FAIL ambiguous-terminal-hold: sole slot lock was not retained"; exit 1; }
kill "$ambiguous_pid" 2>/dev/null || true
wait "$ambiguous_pid" 2>/dev/null || true
echo "PASS ambiguous-terminal-hold: mismatched terminal tuple retained the admitted slot"
