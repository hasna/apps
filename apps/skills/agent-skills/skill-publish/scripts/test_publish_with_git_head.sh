#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
helper="$script_dir/publish_with_git_head.sh"
temp_root=$(mktemp -d)
source_repo="$temp_root/source"
source_package="$source_repo/packages/npm-githead-regression"
linked_worktree="$temp_root/linked-worktree"
linked_package="$linked_worktree/packages/npm-githead-regression"

cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT INT TERM

if [ ! -f "$helper" ]; then
  printf 'MISSING_HELPER: %s\n' "$helper"
  exit 1
fi

mkdir -p "$source_package"
git init -q -b main "$source_repo"
(
  cd "$source_package"
  npm init -y > "$temp_root/npm-init.out" 2> "$temp_root/npm-init.err"
  npm pkg set \
    name=npm-githead-regression \
    version=1.0.0 \
    description="Local npm gitHead regression" \
    license=MIT \
    repository.type=git \
    repository.url=git+https://example.invalid/npm-githead-regression.git \
    scripts.prepublishOnly="node prepublish-probe.cjs" \
    > "$temp_root/npm-pkg-set.out" \
    2> "$temp_root/npm-pkg-set.err"
)
node -e '
  require("node:fs").writeFileSync(
    process.argv[1],
    [
      "const fs = require(\"node:fs\");",
      "const marker = process.env.PROBE_KILL_MARKER;",
      "if (marker) {",
      "  fs.writeFileSync(marker, \"ready\\n\");",
      "  setInterval(() => {}, 1000);",
      "}",
      "",
    ].join("\n"),
  );
' "$source_package/prepublish-probe.cjs"
git -C "$source_repo" config user.name "Provenance Regression"
git -C "$source_repo" config user.email "provenance-regression@example.invalid"
git -C "$source_repo" add packages/npm-githead-regression/package.json \
  packages/npm-githead-regression/prepublish-probe.cjs
git -C "$source_repo" commit --no-verify -q -m "test: seed provenance package"
git -C "$source_repo" worktree add -q -b publish-regression "$linked_worktree" HEAD

expected_head=$(git -C "$linked_worktree" rev-parse HEAD)
cp "$linked_worktree/.git" "$temp_root/original-gitfile"

start_registry() {
  local label=$1
  local status=$2
  capture_prefix="$temp_root/$label"
  port_file="$capture_prefix.port"

  CAPTURE_PUT_STATUS="$status" \
    node "$script_dir/capture_registry.js" "$capture_prefix" "$port_file" \
      > "$capture_prefix.server.out" \
      2> "$capture_prefix.server.err" &
  registry_pid=$!

  for _ in $(seq 1 100); do
    if [ -s "$port_file" ]; then
      break
    fi
    sleep 0.05
  done
  if [ ! -s "$port_file" ]; then
    printf 'REGISTRY_START: FAILED\n'
    return 1
  fi
  registry_port=$(<"$port_file")
}

read_git_head() {
  node -e '
    const body = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const version = Object.values(body.versions)[0];
    process.stdout.write(version.gitHead ?? "");
  ' "$1"
}

assert_source_unchanged() {
  test -f "$linked_worktree/.git"
  cmp -s "$linked_worktree/.git" "$temp_root/original-gitfile"
  test -z "$(git -C "$linked_worktree" status --porcelain)"
}

assert_no_helper_temp() {
  local temp_parent=$1
  if compgen -G "$temp_parent/hasna-publish-githead.*" >/dev/null; then
    printf 'HELPER_TEMP_REMAINS: %s\n' "$temp_parent"
    return 1
  fi
}

publish_args=(
  --access public
  --json
  --fetch-retries=0
  --fetch-retry-mintimeout=1
  --fetch-retry-maxtimeout=1
)

start_registry plain 201
(
  cd "$linked_package"
  npm publish \
    --registry "http://127.0.0.1:$registry_port" \
    "${publish_args[@]}" \
    "--//127.0.0.1:$registry_port/:_authToken=fake-probe-token"
) > "$capture_prefix.publish.out" 2> "$capture_prefix.publish.err"
wait "$registry_pid" 2>/dev/null || true
plain_head=$(read_git_head "$capture_prefix.put.json")
if [ -n "$plain_head" ]; then
  printf 'PLAIN_GITHEAD: %s\n' "$plain_head"
else
  printf 'PLAIN_GITHEAD: ABSENT\n'
fi

success_tmp="$temp_root/success-tmp"
mkdir "$success_tmp"
start_registry helper-success 201
(
  cd "$linked_package"
  TMPDIR="$success_tmp" bash "$helper" \
    --registry "http://127.0.0.1:$registry_port" \
    "${publish_args[@]}" \
    "--//127.0.0.1:$registry_port/:_authToken=fake-probe-token"
) > "$capture_prefix.publish.out" 2> "$capture_prefix.publish.err"
wait "$registry_pid" 2>/dev/null || true
helper_head=$(read_git_head "$capture_prefix.put.json")
printf 'EXPECTED_HEAD: %s\n' "$expected_head"
printf 'HELPER_GITHEAD: %s\n' "${helper_head:-ABSENT}"
test "$helper_head" = "$expected_head"
assert_source_unchanged
assert_no_helper_temp "$success_tmp"
printf 'SUCCESS_SOURCE: unchanged\n'

dirty_tmp="$temp_root/dirty-tmp"
mkdir "$dirty_tmp"
(
  cd "$linked_package"
  npm pkg set description="dirty source must be refused"
)
set +e
(
  cd "$linked_package"
  TMPDIR="$dirty_tmp" bash "$helper" --dry-run
) > "$temp_root/dirty-source.out" 2> "$temp_root/dirty-source.err"
dirty_rc=$?
set -e
test "$dirty_rc" -ne 0
grep -q 'tracked source changes must be committed' "$temp_root/dirty-source.err"
assert_no_helper_temp "$dirty_tmp"
git -C "$linked_worktree" restore packages/npm-githead-regression/package.json
assert_source_unchanged
printf 'DIRTY_SOURCE: refused (helper rc=%s)\n' "$dirty_rc"

failure_tmp="$temp_root/failure-tmp"
mkdir "$failure_tmp"
start_registry helper-failure 500
set +e
(
  cd "$linked_package"
  TMPDIR="$failure_tmp" bash "$helper" \
    --registry "http://127.0.0.1:$registry_port" \
    "${publish_args[@]}" \
    "--//127.0.0.1:$registry_port/:_authToken=fake-probe-token"
) > "$capture_prefix.publish.out" 2> "$capture_prefix.publish.err"
failure_rc=$?
set -e
wait "$registry_pid" 2>/dev/null || true
test "$failure_rc" -ne 0
assert_source_unchanged
assert_no_helper_temp "$failure_tmp"
printf 'FAILURE_SOURCE: unchanged (publish rc=%s)\n' "$failure_rc"

kill_tmp="$temp_root/kill-tmp"
mkdir "$kill_tmp"
kill_marker="$temp_root/kill-ready"
start_registry helper-kill 201
(
  cd "$linked_package"
  exec setsid env TMPDIR="$kill_tmp" PROBE_KILL_MARKER="$kill_marker" \
    bash "$helper" \
      --registry "http://127.0.0.1:$registry_port" \
      "${publish_args[@]}" \
      "--//127.0.0.1:$registry_port/:_authToken=fake-probe-token"
) > "$capture_prefix.publish.out" 2> "$capture_prefix.publish.err" &
helper_pid=$!

for _ in $(seq 1 400); do
  if [ -s "$kill_marker" ]; then
    break
  fi
  sleep 0.05
done
if [ ! -s "$kill_marker" ]; then
  printf 'FORCED_TERMINATION_MARKER: ABSENT\n'
  kill -KILL -- "-$helper_pid" 2>/dev/null || true
  kill "$registry_pid" 2>/dev/null || true
  wait "$helper_pid" 2>/dev/null || true
  wait "$registry_pid" 2>/dev/null || true
  exit 1
fi

kill -KILL -- "-$helper_pid" 2>/dev/null || true
set +e
wait "$helper_pid" 2>/dev/null
kill_rc=$?
set -e
kill "$registry_pid" 2>/dev/null || true
wait "$registry_pid" 2>/dev/null || true
test "$kill_rc" -ne 0
assert_source_unchanged
compgen -G "$kill_tmp/hasna-publish-githead.*" >/dev/null
printf 'FORCED_TERMINATION_SOURCE: unchanged (process rc=%s; disposable clone orphaned)\n' \
  "$kill_rc"
