#!/usr/bin/env bash
# Smoke test for @hasna/test-guard: runs battery section 16 (ac4558ab —
# sentinel canary-failure classification: rc=78 engaged-degraded, rc=124
# engaged/unverified, wrapper-missing NOT ENGAGED) plus sections 17, 18 and 19
# (resolver guard-home adoption, task P3.3) against the REPO copies of
# sentinel.sh and bun-wrapper.sh.
#
# Section 16 is deliberately hermetic: it drives the sentinel with fake
# wrappers and SENTINEL_PROBE_TIMEOUT=3, so it needs no systemd user scope,
# no real bun test, and no machine guard install — only bash, grep, sed,
# mktemp, and the sentinel's static check against /home/hasna/.bun/bin/bun-real.
#
# The full battery (battery.sh) is the regression sweep for a station with the
# guard installed; run it separately after any wrapper/sentinel change.
# Section 19 (resolver guard-home adoption) is hermetic like section 16 — it
# stubs the resolver CLI and drives each script's resolve_guard_dir() as a
# standalone probe, so it runs on any host.
#
# Runner compatibility (hasna/apps#630 remediation, cycle 1): the s16
# classification assertions drive the sentinel's FUNCTIONAL PROBE, and the
# sentinel's static chain gates the probe on the fleet install layout
# (REAL=/home/hasna/.bun/bin/bun-real, sentinel.sh:55). On a host without
# that layout — e.g. the GitHub Actions runner — the static chain fails before
# the probe runs, probe_state stays '', and every classification collapses to
# NOT ENGAGED, failing the assertions for a reason unrelated to the guard.
# s17's rearm-canary exit-0 assertion has the same dependency (the restored
# temp wrapper execs the fleet bun-real). So when the fleet layout is absent
# the smoke SKIPS the classification assertions and the s17 exit-0 assertion
# with a documented skip line, keeping the layout-independent checks (rc!=0,
# wrapper-missing NOT ENGAGED + fail-closed rearm, s17 marker/pin restoration)
# running; on a guard-installed host the full s16+s17 battery runs unchanged.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BATTERY="$HERE/battery.sh"

if [ ! -f "$BATTERY" ]; then
  echo "smoke: battery.sh missing at $BATTERY" >&2
  exit 2
fi

# TEST_GUARD_FLEET_REAL is a TEST-ONLY override of the fleet-layout probe (the
# smoke only stat-checks this path; the sentinel's own REAL is never touched
# by the smoke). It lets the documented skip path be exercised on a
# guard-installed host without mutating the install.
FLEET_REAL="${TEST_GUARD_FLEET_REAL:-/home/hasna/.bun/bin/bun-real}"

# Regression (publish-all-test-guard remediation): the shipped guard MUST NEVER
# source the retired .hasna/cloud runtime config, and MUST NOT carry
# internal-infra station names — the no-cloud guard forbids both patterns in
# packed content (contracts no-cloud scan, runtime_config kind; publish-guard
# station pattern). Release review P1 widened this to the COMPLETE shipped
# file set: the scan previously covered only the three scripts and a
# station-name reference rode into the packed README. The shipped set is the
# package.json "files" list (battery.sh, bun-wrapper.sh, sentinel.sh,
# README.md, LICENSE) — keep this list in sync when that field changes.
CLOUD_GUARD_FAIL=0
if grep -nE '\.hasna/cloud|hasna-cloud-env|station[0-9]+' \
    "$HERE/sentinel.sh" "$HERE/bun-wrapper.sh" "$HERE/battery.sh" \
    "$HERE/README.md" "$HERE/LICENSE"; then
  echo "FAIL no-cloud-guard: retired .hasna/cloud runtime config or station-name reference found in a shipped file" >&2
  CLOUD_GUARD_FAIL=1
else
  echo "PASS no-cloud-guard: no retired .hasna/cloud runtime config or station-name reference in the shipped file set"
fi

# CLI surface regression (a6fc52c7): --help exits 0 with usage; --version
# prints the exact package version; positional $1/$2 contract unchanged.
CLI_FAIL=0
if ! "$HERE/sentinel.sh" --help >/dev/null 2>&1; then
  echo "FAIL cli-help: sentinel.sh --help did not exit 0" >&2
  CLI_FAIL=1
fi
PKG_VERSION=$(grep -m1 '"version"' "$HERE/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
ACTUAL_VERSION=$("$HERE/sentinel.sh" --version 2>/dev/null)
if [ "$ACTUAL_VERSION" != "hasna-test-guard sentinel $PKG_VERSION" ]; then
  echo "FAIL cli-version: sentinel.sh --version printed '$ACTUAL_VERSION', expected 'hasna-test-guard sentinel $PKG_VERSION'" >&2
  CLI_FAIL=1
fi
[ "$CLI_FAIL" = "0" ] && echo "PASS cli-surface: --help exits 0 and --version matches package.json"

# Regression (1804474f, class b335a922): the sentinel's VERSION must DERIVE
# from the package.json BESIDE THE SCRIPT — a wave bumping package.json to a
# new version must flow into `sentinel.sh --version` with no manual edit. The
# prior static constant was the versioning runtime-export drift that failed
# wave PR 791 (the packed artifact carried 0.0.2 while package.json was
# 0.0.3). Proven on a temp-dir COPY of sentinel.sh with a deliberately
# different package.json version: red-before (static literal) prints the
# stale constant; green-after (derive) prints the temp version. The fallback
# for a standalone copy WITHOUT package.json must fail closed (exit non-zero)
# rather than silently report a possibly-stale version — the fleet install at
# ~/.hasna/test-guard is exactly such a copy, and the main probe does not
# depend on VERSION, so only the version surface is affected.
DERIVE_FAIL=0
DERIVE_DIR=$(mktemp -d /tmp/tg-derive.XXXXXX)
cp "$HERE/sentinel.sh" "$DERIVE_DIR/sentinel.sh"
printf '{\n  "name": "@hasna/test-guard",\n  "version": "9.9.9-test"\n}\n' > "$DERIVE_DIR/package.json"
DERIVED=$("$DERIVE_DIR/sentinel.sh" --version 2>/dev/null)
if [ "$DERIVED" != "hasna-test-guard sentinel 9.9.9-test" ]; then
  echo "FAIL cli-version-derive: sentinel.sh --version printed '$DERIVED', expected 'hasna-test-guard sentinel 9.9.9-test' (the version in the package.json beside it)" >&2
  DERIVE_FAIL=1
fi
rm -rf "$DERIVE_DIR"
NOPKG_DIR=$(mktemp -d /tmp/tg-nopkg.XXXXXX)
cp "$HERE/sentinel.sh" "$NOPKG_DIR/sentinel.sh"
if "$NOPKG_DIR/sentinel.sh" --version >/dev/null 2>&1; then
  echo "FAIL cli-version-nopkg: sentinel.sh --version exited 0 in a standalone copy without package.json (would silently report a stale version)" >&2
  DERIVE_FAIL=1
fi
rm -rf "$NOPKG_DIR"
[ "$DERIVE_FAIL" = "0" ] && echo "PASS cli-version-derive: --version derives from the package.json beside the script; standalone copy without package.json fails closed"

# Regression (release review P1): a package-manager global install invokes the
# bin through a SYMLINK (~/.bun/bin/test-guard ->
# .../node_modules/@hasna/test-guard/sentinel.sh). The version must resolve
# from the package.json BESIDE THE REAL SCRIPT, not beside the symlink — the
# pre-fix dirname "$0" reported VERSION unavailable on the installed bin.
# Red-before: dirname "$0"; green-after: portable readlink chain.
SYMLINK_FAIL=0
SYMLINK_DIR=$(mktemp -d /tmp/tg-symlink.XXXXXX)
mkdir -p "$SYMLINK_DIR/bin" "$SYMLINK_DIR/pkg"
cp "$HERE/sentinel.sh" "$SYMLINK_DIR/pkg/sentinel.sh"
printf '{\n  "name": "@hasna/test-guard",\n  "version": "0.0.3"\n}\n' > "$SYMLINK_DIR/pkg/package.json"
ln -s "$SYMLINK_DIR/pkg/sentinel.sh" "$SYMLINK_DIR/bin/test-guard"
SYM_VERSION=$("$SYMLINK_DIR/bin/test-guard" --version 2>/dev/null)
if [ "$SYM_VERSION" != "hasna-test-guard sentinel 0.0.3" ]; then
  echo "FAIL cli-version-symlink: bin-symlink invocation printed '$SYM_VERSION', expected 'hasna-test-guard sentinel 0.0.3' (the version in the package.json beside the real script)" >&2
  SYMLINK_FAIL=1
fi
rm -rf "$SYMLINK_DIR"
[ "$SYMLINK_FAIL" = "0" ] && echo "PASS cli-version-symlink: --version resolves through a bin symlink to the package.json beside the real script"

# Regression (review cycle 2): the wrapper's REAL must honor the TEST-ONLY
# HASNA_TEST_GUARD_REAL override, so hermetic battery runs never exec the
# live bun-real; the production default is unchanged. Red-before: hardcoded
# REAL ignores the env; green-after: the override is honored. Skipped on a
# host without the fleet layout, like the s16/s17 assertions.
REAL_OVERRIDE_FAIL=0
REALOVR=$(mktemp -d /tmp/tg-realovr.XXXXXX)
if cp "$FLEET_REAL" "$REALOVR/bun-real" 2>/dev/null && chmod +x "$REALOVR/bun-real"; then
  OVR_VERSION=$(HASNA_TEST_GUARD_REAL="$REALOVR/bun-real" "$HERE/bun-wrapper.sh" --version 2>/dev/null | head -1)
  EXPECTED_VERSION=$("$REALOVR/bun-real" --version 2>/dev/null | head -1)
  if [ "$OVR_VERSION" != "$EXPECTED_VERSION" ]; then
    echo "FAIL wrapper-real-override: HASNA_TEST_GUARD_REAL not honored — wrapper reported '$OVR_VERSION', expected '$EXPECTED_VERSION'" >&2
    REAL_OVERRIDE_FAIL=1
  fi
else
  echo "SKIP wrapper-real-override: no real bun to copy ($FLEET_REAL missing or not executable)"
fi
rm -rf "$REALOVR"
[ "$REAL_OVERRIDE_FAIL" = "0" ] && echo "PASS wrapper-real-override: HASNA_TEST_GUARD_REAL honored; production default unchanged"

RUNNER="$(mktemp /tmp/tg-smoke.XXXXXX)"
trap 'rm -f "$RUNNER"' EXIT

# Compose: battery preamble (set -u, B/BR/W, pass/failn, ck, WRAPPER_SOURCE,
# SEN — everything section 16 depends on) plus section 16 through the
# battery's own summary/exit. Marker-anchored, not line-numbered, so the
# composition survives edits to either half of battery.sh.
{
  sed -n '1,/^SEN=/p' "$BATTERY"
  sed -n '/^# 16 /,$p' "$BATTERY"
} > "$RUNNER"

if [ ! -x "$FLEET_REAL" ]; then
  # Fleet install layout absent (runner): the sentinel's static chain fails
  # before the functional probe runs, so the classification assertions and the
  # s17 rearm-canary exit-0 assertion are untestable here. Replace each with a
  # documented SKIP line naming the assertion and the reason; the
  # layout-independent checks (rc!=0 against broken wrappers, wrapper-missing
  # NOT ENGAGED + fail-closed rearm, s17 marker/pin restoration) still run.
  echo "smoke: fleet install layout absent ($FLEET_REAL not executable) — s16 functional-probe classification and s17 rearm-canary assertions SKIPPED; rc!=0, fail-closed rearm, and s17 marker/pin restoration checks still run"
  sed -E 's#^ck "((s16 rc=(78|124)[^"]*alert[^"]*|s17 rearm clobbered bun exits 0))".*#echo "SKIP \1 — fleet install layout absent: sentinel functional probe untestable on this host"#' "$RUNNER" > "$RUNNER.skip"
  mv "$RUNNER.skip" "$RUNNER"
fi

export BUN_TEST_GUARD_SENTINEL="$HERE/sentinel.sh"
export BUN_TEST_GUARD_WRAPPER_SOURCE="$HERE/bun-wrapper.sh"

bash "$RUNNER"
RC=$?
if [ "$CLOUD_GUARD_FAIL" = "1" ] || [ "$CLI_FAIL" = "1" ] || [ "$DERIVE_FAIL" = "1" ] || [ "$SYMLINK_FAIL" = "1" ] || [ "$REAL_OVERRIDE_FAIL" = "1" ]; then
  exit 1
fi
exit "$RC"
