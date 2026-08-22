#!/usr/bin/env bash
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/test-guard-controller.XXXXXX)
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
    case "${TEST_GUARD_CONTROLLER_CASE:-active}" in
      absent) exit 4 ;;
      inactive) active_state=inactive ;;
      *) active_state=active ;;
    esac
    id=hasna-tests.slice
    names=hasna-tests.slice
    control_group=/hasna-tests.slice
    memory_max=34359738368
    memory_swap_max=0
    tasks_max=8192
    case "${TEST_GUARD_CONTROLLER_CASE:-active}" in
      unlimited) memory_max=infinity ;;
      nonzero-swap) memory_swap_max=1073741824 ;;
      mismatched)
        id=other.slice
        names=other.slice
        control_group=/other.slice
        ;;
    esac
    printf 'Id=%s\nNames=%s\nLoadState=loaded\nActiveState=%s\nMemoryAccounting=yes\nMemoryMax=%s\nMemorySwapMax=%s\nTasksMax=%s\nControlGroup=%s\n' \
      "$id" "$names" "$active_state" "$memory_max" "$memory_swap_max" "$tasks_max" "$control_group"
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

cat > "$WORK/bin/systemd-run" <<'EOF'
#!/bin/sh
scope_unit=
aggregate_slice=
: > "$TEST_GUARD_SYSTEMD_RUN_ARGS"
while [ "$#" -gt 0 ]; do
  printf '%s\n' "$1" >> "$TEST_GUARD_SYSTEMD_RUN_ARGS"
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
if [ "${TEST_GUARD_CURRENT_CGROUP_CASE:-matching}" = wrong-ancestry ]; then
  printf '0::/other.slice/%s\n' "$scope_unit" > "$HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP"
else
  printf '0::/hasna-tests.slice/%s\n' "$scope_unit" > "$HASNA_TEST_GUARD_TEST_PROC_SELF_CGROUP"
fi
"$@"
rc=$?
printf 'populated 0\n' > "$scope_root/cgroup.events"
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
{"schema":"hasna.test_guard.execution_plan.v1","planId":"controller-enforcement","intent":"execute","runner":"bun","invocation":{"executable":"bun","argv":["test","test/controller-enforcement.test.ts"]},"maySpawn":true,"packages":["@hasna/test-guard"],"targetIds":["test/controller-enforcement.test.ts"],"selector":"explicit","packageWide":false,"workspaceWide":false,"recursive":false,"localCi":false,"lifecycleHooks":[],"dynamicDiscovery":false,"fanout":1,"descendants":[],"limits":{"memoryHighBytes":536870912,"memoryMaxBytes":1073741824,"swapMaxBytes":0,"pidsMax":64,"wallTimeMs":30000}}
EOF

run_case() {
  local controller_case=$1
  local cgroup_case=${2:-matching}
  local forged=${3:-0}
  local case_root="$WORK/case-$controller_case-$cgroup_case-$forged"
  mkdir -p "$case_root/guard" "$case_root/cgroup"
  printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=2\n' > "$case_root/guard/config"
  printf '0::/unassigned.scope\n' > "$case_root/proc-self-cgroup"
  rm -f "$case_root/sentinel" "$case_root/systemd-run.args" "$case_root/scope-unit"

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
    HASNA_TEST_GUARD_SCOPE_CONTROLS_VERIFIED="$forged" \
    HASNA_TEST_GUARD_AGGREGATE_CONTROLLER_VERIFIED="$forged" \
    TEST_GUARD_BUN="$(command -v bun)" \
    TEST_GUARD_CONTROLLER_CASE="$controller_case" \
    TEST_GUARD_CURRENT_CGROUP_CASE="$cgroup_case" \
    TEST_GUARD_CGROUP_BASE="$case_root/cgroup" \
    TEST_GUARD_SCOPE_UNIT_FILE="$case_root/scope-unit" \
    TEST_GUARD_SYSTEMD_RUN_ARGS="$case_root/systemd-run.args" \
    TEST_GUARD_SENTINEL="$case_root/sentinel" \
    "$WORK/bun-wrapper.sh" test test/controller-enforcement.test.ts \
    > "$case_root/stdout" 2> "$case_root/stderr"
  CASE_RC=$?
  set -e
  CASE_ROOT=$case_root
}

run_case active
[ "$CASE_RC" -eq 0 ] || { echo "FAIL controller-admission: matching controller rc=$CASE_RC"; exit 1; }
[ -e "$CASE_ROOT/sentinel" ] || { echo "FAIL controller-admission: matching controller did not spawn sentinel"; exit 1; }
grep -Fxq -- '--slice=hasna-tests.slice' "$CASE_ROOT/systemd-run.args" || {
  echo "FAIL slice-binding: systemd-run invocation omitted --slice=hasna-tests.slice"
  exit 1
}
echo "PASS controller-admission: active finite zero-swap aggregate plus nested leaf admitted"
echo "PASS slice-binding: systemd-run used --slice=hasna-tests.slice"

for controller_case in absent inactive unlimited nonzero-swap mismatched; do
  run_case "$controller_case"
  [ "$CASE_RC" -eq 78 ] || { echo "FAIL controller-refusal: $controller_case rc=$CASE_RC"; exit 1; }
  [ ! -e "$CASE_ROOT/sentinel" ] || { echo "FAIL controller-refusal: $controller_case spawned sentinel"; exit 1; }
  [ ! -e "$CASE_ROOT/systemd-run.args" ] || { echo "FAIL controller-refusal: $controller_case acquired a local scope"; exit 1; }
done
echo "PASS controller-refusal: absent inactive unlimited non-zero-swap and mismatched controllers refused before spawn"

run_case absent matching 1
[ "$CASE_RC" -eq 78 ] || { echo "FAIL forged-evidence: absent controller with forged environment rc=$CASE_RC"; exit 1; }
[ ! -e "$CASE_ROOT/sentinel" ] || { echo "FAIL forged-evidence: forged environment spawned sentinel"; exit 1; }
echo "PASS forged-evidence: caller environment claims could not replace controller verification"

run_case active wrong-ancestry
[ "$CASE_RC" -eq 78 ] || { echo "FAIL cgroup-ancestry: wrong ancestry rc=$CASE_RC"; exit 1; }
[ ! -e "$CASE_ROOT/sentinel" ] || { echo "FAIL cgroup-ancestry: wrong ancestry spawned sentinel"; exit 1; }
echo "PASS cgroup-ancestry: runtime refused a process outside the aggregate leaf scope"
