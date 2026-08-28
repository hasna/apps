#!/bin/bash
# SC-00062 full regression battery. Every check prints PASS/FAIL + evidence.
# Run on a station with the guard installed. Uses only isolated guard dirs.
set -u
B=${BUN_TEST_GUARD_BUN:-/home/hasna/.bun/bin/bun}
BR=${BUN_TEST_GUARD_REAL_BUN:-/home/hasna/.bun/bin/bun-real}
W=$(mktemp -d /tmp/tg-battery.XXXXXX)
mkdir -p "$W/g1/slots" "$W/suite"
pass=0; failn=0
ck() { if [ "$2" = "$3" ]; then echo "PASS $1 [$2]"; pass=$((pass+1)); else echo "FAIL $1 [got:$2 want:$3]"; failn=$((failn+1)); fi; }
# run_scoped mirrors the wrapper's own prepare_systemd_user_manager seam
# (remediation 2026-08-22): the battery's direct systemd-run --user --scope
# checks (sections 7/8) failed with "Failed to connect to bus: No medium
# found" when run from a headless shell — background/cron contexts carry no
# XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS. When the user bus is reachable,
# behave exactly as before; otherwise fall back to the /run/user/<uid> bus
# the same way the wrapper does, and only when the directory exists and is
# ours. If neither route works, the honest failure still surfaces.
run_scoped() {
  local uid dir
  if systemctl --user show-environment >/dev/null 2>&1; then
    systemd-run --user --scope --quiet --collect "$@"
    return $?
  fi
  uid=$(id -u 2>/dev/null) || uid=""
  dir="/run/user/$uid"
  if [ -n "$uid" ] && [ -d "$dir" ] && [ -O "$dir" ] && [ -w "$dir" ]; then
    env -u DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR="$dir" \
      systemd-run --user --scope --quiet --collect "$@"
    return $?
  fi
  systemd-run --user --scope --quiet --collect "$@"
}
WRAPPER_SOURCE=${BUN_TEST_GUARD_WRAPPER_SOURCE:-/home/hasna/.hasna/test-guard/bun-wrapper.sh}
SEN=${BUN_TEST_GUARD_SENTINEL:-/home/hasna/.hasna/test-guard/sentinel.sh}

cat > "$W/suite/ok.test.ts" <<'EOF'
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

test("bun test runs inside the fleet memory scope", () => {
  if (process.env.BUN_TEST_CGROUP_ASSERT_SKIP === "1") {
    expect(true).toBe(true);
    return;
  }

  const cgroup = readFileSync("/proc/self/cgroup", "utf8").trim().split("::")[1];
  const root = `/sys/fs/cgroup${cgroup}`;

  expect(readFileSync(`${root}/memory.high`, "utf8").trim()).toBe("12884901888");
  expect(readFileSync(`${root}/memory.max`, "utf8").trim()).toBe("17179869184");
  expect(readFileSync(`${root}/memory.swap.max`, "utf8").trim()).toBe("0");
  expect(readFileSync(`${root}/pids.max`, "utf8").trim()).toBe("4096");
});
EOF
cat > "$W/suite/bad.test.ts.off" <<'EOF'
import { test, expect } from "bun:test";
test("bad", () => { expect(1).toBe(2); });
EOF

# 1 basic fidelity
ck "bun --version" "$($B --version >/dev/null 2>&1; echo $?)" "0"
ck "bunx --version" "$(bunx --version >/dev/null 2>&1; echo $?)" "0"
ck "bun -e eval" "$($B -e 'console.log(42)' 2>/dev/null)" "42"
ck "bun-shebang CLI (todos)" "$(todos --version >/dev/null 2>&1; echo $?)" "0"

# 2 guard engagement + output fidelity (pass suite)
out=$(cd "$W/suite" && HASNA_TEST_GUARD_DIR="$W/g1" $B test 2>&1); rc=$?
ck "pass-suite rc" "$rc" "0"
ck "pass-suite output" "$(printf '%s' "$out" | grep -c '1 pass')" "1"
ck "guard engaged argv" "$(grep -c 'acquired .*argv=test' "$W/g1/guard.log")" "1"

# 3 failing suite exit-code + stderr fidelity
mv "$W/suite/bad.test.ts.off" "$W/suite/bad.test.ts"; mv "$W/suite/ok.test.ts" "$W/suite/ok.test.ts.off"
out=$(cd "$W/suite" && HASNA_TEST_GUARD_DIR="$W/g1" $B test 2>&1); rc=$?
ck "fail-suite rc" "$rc" "1"
ck "fail-suite output" "$(printf '%s' "$out" | grep -c '1 fail')" "1"
mv "$W/suite/bad.test.ts" "$W/suite/bad.test.ts.off"; mv "$W/suite/ok.test.ts.off" "$W/suite/ok.test.ts"

# 4 env fidelity through wrapper
export TG_BATT_VAR=x
ck "env -u honored" "$(env -u TG_BATT_VAR $B -e 'console.log("TG_BATT_VAR" in process.env)' 2>/dev/null)" "false"
ck "cloud var env -u honored" "$(env -u HASNA_TODOS_API_URL $B -e 'console.log("HASNA_TODOS_API_URL" in process.env)' 2>/dev/null)" "false"
ck "override kept" "$(HASNA_TODOS_API_URL=http://sentinel.invalid $B -e 'console.log(process.env.HASNA_TODOS_API_URL==="http://sentinel.invalid"?"kept":"clobbered")' 2>/dev/null)" "kept"
unset TG_BATT_VAR

# 5 FIFO ordering, 1 slot, 2 staggered waiters
mkdir -p "$W/g2/slots"; printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=60\n' > "$W/g2/config"
cp -R "$W/suite" "$W/suite-a"
cp -R "$W/suite" "$W/suite-b"
( exec 9>>"$W/g2/slots/slot-0"; flock 9; sleep 6 ) &
sleep 1
( cd "$W/suite-a" && HASNA_TEST_GUARD_DIR="$W/g2" $B test >/dev/null 2>&1 ) &
sleep 2
( cd "$W/suite-b" && HASNA_TEST_GUARD_DIR="$W/g2" $B test >/dev/null 2>&1 ) &
wait
order=$(awk '/acquired/ { if ($0 ~ /suite-a/) printf "A"; else if ($0 ~ /suite-b/) printf "B" }' "$W/g2/guard.log")
ck "fifo acquisition order" "$order" "AB"

# 6 fail-closed rc=75
mkdir -p "$W/g3/slots"; printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=6\n' > "$W/g3/config"
( exec 9>>"$W/g3/slots/slot-0"; flock 9; sleep 12 ) &
sleep 1
( cd "$W/suite" && HASNA_TEST_GUARD_DIR="$W/g3" $B test >/dev/null 2>"$W/fc.err" ); rc=$?
ck "fail-closed rc" "$rc" "75"
ck "fail-closed loud" "$(grep -c 'refusing to run unbounded' "$W/fc.err")" "1"
wait

# 7 nested HELD + BYPASS with slot held
mkdir -p "$W/g4/slots"; printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=6\n' > "$W/g4/config"
( exec 9>>"$W/g4/slots/slot-0"; flock 9; sleep 8 ) &
sleep 1
rc=$(cd "$W/suite" && HASNA_TEST_GUARD_DIR="$W/g4" HASNA_TEST_GUARD_HELD=1 $B test >/dev/null 2>&1; echo $?)
ck "forged HELD outside scope cannot bypass busy slot" "$rc" "75"
rc=$(cd "$W/suite" && run_scoped \
  -p MemoryHigh=12G -p MemoryMax=16G -p MemorySwapMax=0 -p TasksMax=4096 \
  -- env HASNA_TEST_GUARD_DIR="$W/g4" HASNA_TEST_GUARD_HELD=1 "$B" test >/dev/null 2>&1; echo $?)
ck "bounded nested HELD runs without reacquiring" "$rc" "0"
rc=$(cd "$W/suite" && BUN_TEST_CGROUP_ASSERT_SKIP=1 HASNA_TEST_GUARD_DIR="$W/g4" HASNA_TEST_GUARD_BYPASS=1 $B test >/dev/null 2>&1; echo $?)
ck "BYPASS runs" "$rc" "0"
wait

# 8 a finite but loose outer scope must not be trusted as the fleet scope
mkdir -p "$W/g-loose/slots"
rc=$(cd "$W/suite" && run_scoped \
  -p MemoryHigh=32G -p MemoryMax=64G -p MemorySwapMax=0 -p TasksMax=8192 \
  -- env HASNA_TEST_GUARD_DIR="$W/g-loose" HASNA_TEST_GUARD_HELD=1 "$B" test >/dev/null 2>&1; echo $?)
ck "loose existing scope is re-guarded" "$rc" "0"

# 9 the semaphore lock must remain held until each scoped suite exits
mkdir -p "$W/g-serial/slots" "$W/slow-suite"
printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=30\n' > "$W/g-serial/config"
cat > "$W/slow-suite/slow.test.ts" <<'EOF'
import { test, expect } from "bun:test";
test("slow", async () => { await Bun.sleep(1500); expect(1).toBe(1); });
EOF
serial_start=$(date +%s%N)
( cd "$W/slow-suite" && HASNA_TEST_GUARD_DIR="$W/g-serial" $B test >/dev/null 2>&1 ) &
( cd "$W/slow-suite" && HASNA_TEST_GUARD_DIR="$W/g-serial" $B test >/dev/null 2>&1 ) &
wait
serial_ms=$(( ($(date +%s%N) - serial_start) / 1000000 ))
if [ "$serial_ms" -ge 2800 ]; then serialized=1; else serialized=0; fi
ck "scope lifetime keeps slot serialized" "$serialized" "1"

# 10 no user systemd scope means fail closed instead of paging unbounded
mkdir -p "$W/g-no-systemd/slots" "$W/no-systemd-bin"
for tool in awk cat date flock grep head logger ls mkdir rm sort sleep tail uname; do
  ln -s "$(command -v "$tool")" "$W/no-systemd-bin/$tool"
done
rc=$(cd "$W/suite" && PATH="$W/no-systemd-bin" HASNA_TEST_GUARD_DIR="$W/g-no-systemd" "$B" test >/dev/null 2>&1; echo $?)
ck "no-systemd fails closed" "$rc" "78"

# 11 cron and minimal agent environments must reconstruct the user-manager
# transport without leaking that synthetic XDG_RUNTIME_DIR into the suite.
mkdir -p "$W/g-cron/slots" "$W/cron-suite"
cat > "$W/cron-suite/cron.test.ts" <<'EOF'
import { test, expect } from "bun:test";
test("sanitized invocation keeps caller env exact", () => {
  expect("XDG_RUNTIME_DIR" in process.env).toBe(false);
});
EOF
rc=$(cd "$W/cron-suite" && env -i HOME=/home/hasna PATH=/usr/bin:/bin \
  HASNA_TEST_GUARD_DIR="$W/g-cron" "$B" test >/dev/null 2>&1; echo $?)
ck "sanitized cron env enters bounded scope" "$rc" "0"

mkdir -p "$W/g-stale-bus/slots" "$W/stale-bus-suite"
cat > "$W/stale-bus-suite/stale-bus.test.ts" <<'EOF'
import { test, expect } from "bun:test";
test("manager transport repair preserves stale caller values for bun", () => {
  expect(process.env.XDG_RUNTIME_DIR).toBe("/nonexistent-caller-runtime");
  expect(process.env.DBUS_SESSION_BUS_ADDRESS).toBe("unix:path=/nonexistent-caller-bus");
});
EOF
rc=$(cd "$W/stale-bus-suite" && env -i HOME=/home/hasna PATH=/usr/bin:/bin \
  XDG_RUNTIME_DIR=/nonexistent-caller-runtime \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent-caller-bus \
  HASNA_TEST_GUARD_DIR="$W/g-stale-bus" "$B" test >/dev/null 2>&1; echo $?)
ck "stale DBus/XDG transport is repaired and restored" "$rc" "0"

# 12 limit parsing must reject malformed and overflowing values before shell
# arithmetic can turn them into zero/negative values.
parser="$W/parse-limit.sh"
{
  printf '%s\n' '#!/bin/bash --posix'
  sed -n '/^limit_to_number()/,/^}/p' "$WRAPPER_SOURCE"
  printf '%s\n' 'limit_to_number "$1"'
} > "$parser"
chmod +x "$parser"
ck "limit parser rejects empty prefix" "$("$parser" G >/dev/null 2>&1; echo $?)" "1"
ck "limit parser rejects garbage prefix" "$("$parser" garbageG >/dev/null 2>&1; echo $?)" "1"
ck "limit parser rejects signed input" "$("$parser" -1G >/dev/null 2>&1; echo $?)" "1"
ck "limit parser rejects overflow" "$("$parser" 8388608T >/dev/null 2>&1; echo $?)" "1"
ck "limit parser accepts largest TiB value" "$("$parser" 8388607T 2>/dev/null)" "9223370937343148032"
ck "limit parser accepts signed-64 maximum" "$("$parser" 9223372036854775807 2>/dev/null)" "9223372036854775807"
ck "limit parser rejects signed-64 max plus one" "$("$parser" 9223372036854775808 >/dev/null 2>&1; echo $?)" "1"
ck "limit parser rejects larger 19-digit overflow" "$("$parser" 9999999999999999999 >/dev/null 2>&1; echo $?)" "1"

# 13 sentinel must reject a wrapper that keeps the marker but differs from
# the installed source of truth. With auto-rearm (row 7112181b) the sentinel
# HEALS such a tamper when the rearm can complete (section 17) and FAILS
# CLOSED when it cannot — this hermetic fixture proves the fail-closed half
# (no pinned bun obtainable, download forced to fail via a file:// URL) and
# that a battery run never writes into the live bin dir.
cp "$B" "$W/marker-preserving-wrapper"
printf '\n# marker-preserving tamper\n' >> "$W/marker-preserving-wrapper"
chmod +x "$W/marker-preserving-wrapper"
ck "sentinel fails closed on unrepairable marker-preserving tamper" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g-tamper" SENTINEL_REAL_BUN="$W/no-real" SENTINEL_PINNED_URL="file://$W/no-pin" "$SEN" "$W/marker-preserving-wrapper" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"

signature_probe="$W/sentinel-signature.sh"
{
  printf '%s\n' '#!/usr/bin/env bash'
  sed -n '/^failure_signature()/,/^}/p' "$SEN"
  printf '%s\n' 'failure_signature "$1"'
} > "$signature_probe"
chmod +x "$signature_probe"
sig_a=$("$signature_probe" 'production queue wedged: oldest live ticket 1.2 is 2101s old' 2>/dev/null); sig_a_rc=$?
sig_b=$("$signature_probe" 'production queue wedged: oldest live ticket 1.2 is 2301s old' 2>/dev/null); sig_b_rc=$?
ck "sentinel signature helper exists" "$sig_a_rc:$sig_b_rc" "0:0"
ck "queue-wedge damping signature is stable" "$sig_a" "$sig_b"

# 14 P2-1 queue-dir deletion recovery
mkdir -p "$W/g5/slots"; printf 'MAX_SLOTS=1\nMAX_WAIT_SECS=40\n' > "$W/g5/config"
( exec 9>>"$W/g5/slots/slot-0"; flock 9; sleep 8 ) &
sleep 1
( cd "$W/suite" && HASNA_TEST_GUARD_DIR="$W/g5" $B test >/dev/null 2>&1; echo $? > "$W/g5rc" ) &
sleep 3; rm -rf "$W/g5/queue"
wait
ck "queue-del recovery" "$(cat "$W/g5rc")" "0"

# 15 sentinel: pass, cgroup removal, marker tamper, junk-name crash input, wedge alert
# Section 15 is fully hermetic (release review P1, cycles 1-2): the previous
# forms invoked the sentinel with LIVE defaults — a healthy run wrote the live
# guard-dir sentinel.log, and a clobbered install would have auto-rearmed the
# LIVE wrapper and bun-real mid-battery. Every sentinel invocation below
# drives the temp wrapper copy $W/pass-bun-wrapper and the temp real-bun copy
# $W/pass-bun-real plus a temp guard dir; HASNA_TEST_GUARD_REAL redirects the
# temp wrapper's own REAL (bun-wrapper.sh test-only override) so even the
# canary probe execs the temp copy, never the live bun-real.
mkdir -p "$W/g-pass/slots"
cp "$WRAPPER_SOURCE" "$W/pass-bun-wrapper"
chmod +x "$W/pass-bun-wrapper"
cp "$BR" "$W/pass-bun-real" 2>/dev/null || cp "$(command -v bun)" "$W/pass-bun-real"
chmod +x "$W/pass-bun-real"
ck "sentinel pass" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g-pass" SENTINEL_REAL_BUN="$W/pass-bun-real" HASNA_TEST_GUARD_REAL="$W/pass-bun-real" SENTINEL_PINNED_URL="file://$W/no-pin-pass" "$SEN" "$W/pass-bun-wrapper" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "0"
# The unscoped-wrapper and marker-tamper fixtures moved to hermetic temp
# copies: with auto-rearm (row 7112181b) the sentinel HEALS a repairable
# clobber (section 17), and the old fixtures pointed at LIVE paths
# (/home/hasna/.bun/bin/bun.pre-ce9c2402 backup, bun-real) that a rearm would
# now legitimately overwrite during a battery run. These variants force the
# rearm to fail closed (all-zero pin, unobtainable file:// download).
printf '#!/usr/bin/env bash\nexec /home/hasna/.bun/bin/bun-real "$@"\n' > "$W/unscoped-wrapper"
chmod +x "$W/unscoped-wrapper"
ck "sentinel fails closed on unscoped wrapper" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g-unscoped" SENTINEL_REAL_BUN="$W/no-real" SENTINEL_PINNED_URL="file://$W/no-pin" "$SEN" "$W/unscoped-wrapper" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"
cp "$BR" "$W/tamper-bun" 2>/dev/null || cp "$(command -v bun)" "$W/tamper-bun"
chmod +x "$W/tamper-bun"
ck "sentinel fails closed on marker-tamper ELF" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g-tamper2" SENTINEL_REAL_BUN="$W/no-real2" SENTINEL_PINNED_URL="file://$W/no-pin2" SENTINEL_PINNED_SHA256="0000000000000000000000000000000000000000000000000000000000000000" "$SEN" "$W/tamper-bun" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"
mkdir -p "$W/g6/slots" "$W/g6/queue"; : > "$W/g6/queue/not-a-ticket"
ck "sentinel junk survives" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g6" SENTINEL_REAL_BUN="$W/pass-bun-real" HASNA_TEST_GUARD_REAL="$W/pass-bun-real" "$SEN" "$W/pass-bun-wrapper" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "0"
: > "$W/g6/queue/$(( $(date +%s%N) - 2200000000000 )).$$"
ck "sentinel wedge alerts" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g6" SENTINEL_REAL_BUN="$W/pass-bun-real" HASNA_TEST_GUARD_REAL="$W/pass-bun-real" "$SEN" "$W/pass-bun-wrapper" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"

# 16 sentinel classifies canary failures per state (ac4558ab). The probe's
# exit code has THREE causes that previously collapsed into one 'NOT ENGAGED'
# alert: wrapper missing (static check), wrapper fail-closed refusal (rc=78,
# systemd user scopes unavailable), and external timeout (rc=124, saturated
# machine). For 78 and 124-with-acquisition the wrapper RAN — the cap is
# ENGAGED, never 'not engaged'; 124-without-acquisition is UNVERIFIABLE.
# Only wrapper-missing / silent bypass may word the alert NOT ENGAGED.
# SENTINEL_PROBE_TIMEOUT is a TEST-ONLY probe-budget override (mirroring the
# documented SENTINEL_GUARD_DIR seam) so the rc=124 fixture does not wait 120s.
S16="$W/s16"
mkdir -p "$S16"
fake_refuse="$S16/fake-refuse-wrapper"
fake_starve="$S16/fake-starve-wrapper"
fake_starve_nolog="$S16/fake-starve-nolog-wrapper"
cat > "$fake_refuse" <<'EOF'
#!/usr/bin/env bash
set -u
echo "hasna-test-guard wrapper (ac4558ab sentinel fixture)"
GUARD="${HASNA_TEST_GUARD_DIR:?}"
mkdir -p "$GUARD"
printf '%s pid=%s ppid=%s acquired slot=0 waited=0s cwd=%s argv=test\n' "$(date -u +%FT%TZ)" "$$" "$PPID" "$PWD" >> "$GUARD/guard.log"
exit 78
EOF
cat > "$fake_starve" <<'EOF'
#!/usr/bin/env bash
set -u
echo "hasna-test-guard wrapper (ac4558ab sentinel fixture)"
GUARD="${HASNA_TEST_GUARD_DIR:?}"
mkdir -p "$GUARD"
printf '%s pid=%s ppid=%s acquired slot=0 waited=0s cwd=%s argv=test\n' "$(date -u +%FT%TZ)" "$$" "$PPID" "$PWD" >> "$GUARD/guard.log"
sleep 30
EOF
cat > "$fake_starve_nolog" <<'EOF'
#!/usr/bin/env bash
set -u
echo "hasna-test-guard wrapper (ac4558ab sentinel fixture)"
sleep 30
EOF
chmod +x "$fake_refuse" "$fake_starve" "$fake_starve_nolog"
run_sentinel_dry() {
  SENTINEL_DRY_RUN=1 SENTINEL_PROBE_TIMEOUT=3 "$SEN" "$1" "$1" > "$S16/out" 2> "$S16/err"
  echo $?
}
s_rc=$(run_sentinel_dry "$fake_refuse")
ck "s16 rc=78 sentinel still fails" "$s_rc" "1"
ck "s16 rc=78 alert says cap ENGAGED but DEGRADED" "$(grep -c 'cap ENGAGED but DEGRADED' "$S16/out")" "1"
ck "s16 rc=78 alert never says NOT ENGAGED" "$(grep -c 'NOT ENGAGED' "$S16/out")" "0"
ck "s16 rc=78 alert never says unbounded again" "$(grep -c 'unbounded again' "$S16/out")" "0"
ck "s16 rc=78 alert never says Reinstall per" "$(grep -c 'Reinstall per' "$S16/out")" "0"
s_rc=$(run_sentinel_dry "$fake_starve")
ck "s16 rc=124-with-acquired sentinel still fails" "$s_rc" "1"
ck "s16 rc=124-with-acquired alert says cap ENGAGED but DEGRADED" "$(grep -c 'cap ENGAGED but DEGRADED' "$S16/out")" "1"
ck "s16 rc=124-with-acquired alert never says NOT ENGAGED" "$(grep -c 'NOT ENGAGED' "$S16/out")" "0"
s_rc=$(run_sentinel_dry "$fake_starve_nolog")
ck "s16 rc=124-no-acquired sentinel still fails" "$s_rc" "1"
ck "s16 rc=124-no-acquired alert says UNVERIFIABLE" "$(grep -c 'engagement UNVERIFIABLE' "$S16/out")" "1"
ck "s16 rc=124-no-acquired alert never says NOT ENGAGED" "$(grep -c 'NOT ENGAGED' "$S16/out")" "0"
# wrapper-missing (marker gone) is the one state where NOT ENGAGED is correct —
# and with auto-rearm (row 7112181b) it is the state where rearm is ATTEMPTED.
# This hermetic fixture (temp paths, pin download forced to fail via a file://
# URL) proves the fail-closed half: a clobber that cannot be repaired keeps the
# alert path and NEVER touches the live bin dir (the old fixture passed the
# live bun.pre-ce9c2402 backup path, which a rearm would now overwrite).
s_rc=$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$S16/g" SENTINEL_REAL_BUN="$S16/no-such-real" SENTINEL_PINNED_URL="file://$S16/no-such-pin" "$SEN" "$S16/no-such-wrapper" "$WRAPPER_SOURCE" > "$S16/out" 2> "$S16/err"; echo $?)
ck "s16 wrapper-missing sentinel still fails" "$s_rc" "1"
ck "s16 wrapper-missing alert says NOT ENGAGED" "$(grep -c 'NOT ENGAGED' "$S16/out")" "1"
ck "s16 wrapper-missing rearm fails closed" "$(grep -c 'auto-rearm FAILED' "$S16/out")" "1"

# 17 auto-rearm on a temp-dir COPY of the bin layout (row 7112181b): a
# marker-absent bun ELF (the curl-installer clobber shape) is HEALED — the
# wrapper is restored byte-identical from the package source, bun-real is
# re-pinned to the pinned version (sha-verified) via mv-over-held-inode, and
# the sentinel's own functional canary (rc=0, '1 pass', exact cgroup limits,
# acquired argv=test) must pass before it may exit 0. Never run the simulated
# clobber on the live path: everything here is a temp copy.
W17="$W/s17"; BIN17="$W17/bin"; G17="$W17/guard"
mkdir -p "$BIN17" "$G17/slots"
if [ -x "$BR" ]; then ELF_SRC="$BR"; else ELF_SRC="$(command -v bun)"; fi
cp "$ELF_SRC" "$BIN17/bun"
cp "$ELF_SRC" "$BIN17/bun-real"
printf '\n# simulated stale real\n' >> "$BIN17/bun-real"   # differs from the pinned build
chmod +x "$BIN17/bun" "$BIN17/bun-real"
PIN_SHA=$(sha256sum "$BIN17/bun" | awk '{print $1}')
PIN_VER=$("$BIN17/bun" --version 2>/dev/null | head -1)
s17_rc=$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$G17" SENTINEL_REAL_BUN="$BIN17/bun-real" SENTINEL_PINNED_SHA256="$PIN_SHA" SENTINEL_PINNED_VERSION="$PIN_VER" "$SEN" "$BIN17/bun" "$WRAPPER_SOURCE" > "$W17/out" 2>&1; echo $?)
ck "s17 rearm clobbered bun exits 0" "$s17_rc" "0"
ck "s17 rearm restores wrapper marker" "$(head -c 4096 "$BIN17/bun" | grep -c 'hasna-test-guard wrapper')" "1"
ck "s17 rearm wrapper byte-identical to source" "$(cmp -s "$BIN17/bun" "$WRAPPER_SOURCE"; echo $?)" "0"
ck "s17 rearm pins bun-real version" "$("$BIN17/bun-real" --version 2>/dev/null | head -1)" "$PIN_VER"
ck "s17 rearm pins bun-real sha" "$(sha256sum "$BIN17/bun-real" | awk '{print $1}')" "$PIN_SHA"
ck "s17 rearm logs to sentinel.log" "$(grep -c 'rearm:' "$G17/sentinel.log")" "1"

# 18 sandbox degradation (I38-00746): inside codewith sandboxes (e2b Docker
# containers) the fleet wrapper install has no systemd user scope and a
# read-only guard dir, so `bun test` REFUSED (78) or wedged the FIFO queue
# (75) — blocking independent review test evidence. A container invocation
# must degrade to a direct, logged exec of bun-real (the sandbox is already
# bounded by its own container cgroup); an unwritable queue on a
# NON-container host must fail closed immediately and loudly (never run
# unbounded, never wedge). The station's fail-closed paths (sections 6/10)
# are unchanged and re-proven by the non-container control below. Runs the
# WRAPPER SOURCE against a temp copy of bun-real via the
# HASNA_TEST_GUARD_REAL seam; on a host without a usable bun the section
# skips like s16/s17. On a host that is ITSELF a container (CI runner), the
# container-path assertions run against the real /.dockerenv marker and the
# non-container control skips.
W18="$W/s18"; G18="$W18/guard"; S18SUITE="$W18/suite"
mkdir -p "$G18/slots" "$S18SUITE"
cat > "$S18SUITE/sandbox.test.ts" <<'EOF'
import { test, expect } from "bun:test";
test("sandbox suite runs unscoped", () => { expect(1).toBe(1); });
EOF
if [ -x "$BR" ]; then ELF18="$BR"; else ELF18="$(command -v bun 2>/dev/null || true)"; fi
if [ -n "$ELF18" ] && cp "$ELF18" "$W18/real-bun" 2>/dev/null && chmod +x "$W18/real-bun"; then
  s18_out=$(cd "$S18SUITE" && container=docker \
    HASNA_TEST_GUARD_DIR="$G18" HASNA_TEST_GUARD_REAL="$W18/real-bun" \
    bash "$WRAPPER_SOURCE" test 2>&1); s18_rc=$?
  ck "s18 container direct-exec rc" "$s18_rc" "0"
  ck "s18 container direct-exec output" "$(printf '%s' "$s18_out" | grep -c '1 pass')" "1"
  ck "s18 container logged SANDBOX" "$(grep -c 'SANDBOX .*argv=test' "$G18/guard.log")" "1"
  if [ ! -f /.dockerenv ] && [ ! -f /run/.containerenv ] && [ "${container:-}" != "docker" ]; then
    s18_ctrl=$(cd "$S18SUITE" && env -u container \
      HASNA_TEST_GUARD_DIR="$G18" HASNA_TEST_GUARD_REAL="$W18/real-bun" \
      bash "$WRAPPER_SOURCE" test >/dev/null 2>&1; echo $?)
    ck "s18 non-container still engages guard" "$s18_ctrl" "0"
    ck "s18 non-container not logged SANDBOX" "$(grep -c 'SANDBOX .*argv=test' "$G18/guard.log")" "1"
  else
    echo "SKIP s18 non-container control — this host is itself a container (/.dockerenv|/run/.containerenv|container env)"
  fi
else
  echo "SKIP s18 sandbox direct-exec — no bun binary to copy"
fi
G18Q="$W18/g-qro"
mkdir -p "$G18Q" "$G18Q/slots" "$G18Q/queue" "$W18/qro-suite"
cp "$S18SUITE/sandbox.test.ts" "$W18/qro-suite/sandbox.test.ts" 2>/dev/null || true
printf 'MAX_WAIT_SECS=10\n' > "$G18Q/config"
if [ -x "$W18/real-bun" ]; then
  chmod 555 "$G18Q/queue"
  s18q=$(cd "$W18/qro-suite" && HASNA_TEST_GUARD_DIR="$G18Q" HASNA_TEST_GUARD_REAL="$W18/real-bun" \
    bash "$WRAPPER_SOURCE" test 2>&1); s18q_rc=$?
  chmod 755 "$G18Q/queue"
  if [ ! -f /.dockerenv ] && [ ! -f /run/.containerenv ] && [ "${container:-}" != "docker" ]; then
    # Non-container host (station): an unwritable queue must FAIL CLOSED
    # immediately (rc=75, no suite run) — never run unbounded. Red-before:
    # the old wrapper wedged MAX_WAIT then exited 75 without the REFUSED
    # line; the first fix attempt wrongly degraded to an unscoped run.
    ck "s18 read-only queue fails closed rc" "$s18q_rc" "75"
    ck "s18 read-only queue did not run suite" "$(printf '%s' "$s18q" | grep -c '1 pass')" "0"
    ck "s18 read-only queue logged REFUSED" "$(grep -c 'REFUSED queue-unwritable .*argv=test' "$G18Q/guard.log")" "1"
  else
    # Container host (CI runner): the SANDBOX direct-exec path fires before
    # the queue is ever touched — the suite runs, rc=0.
    ck "s18 container read-only queue direct-exec rc" "$s18q_rc" "0"
    ck "s18 container read-only queue output" "$(printf '%s' "$s18q" | grep -c '1 pass')" "1"
    ck "s18 container read-only queue logged SANDBOX" "$(grep -c 'SANDBOX .*argv=test' "$G18Q/guard.log")" "1"
  fi
else
  echo "SKIP s18 read-only queue — no bun binary to copy"
fi

# 19 resolver guard-home adoption (XDG home migration, task P3.3): the guard
# home default must route through @hasna/paths when the resolver is available
# and the resolved home is adopted, and fall back to the legacy
# ~/.hasna/test-guard home otherwise — an existing guard install never becomes
# invisible on upgrade. Hermetic: the resolver CLI is stubbed (a fake `paths`
# binary on PATH echoing $S19_RESOLVED), and each script's resolve_guard_dir()
# is extracted into a standalone probe exactly like section 12's
# limit_to_number probe. No bun, no fleet install, no live guard dir.
W19="$W/s19"; S19BIN="$W19/bin"; mkdir -p "$S19BIN"
S19_RESOLVED="$W19/resolved-home"
cat > "$S19BIN/paths" <<'EOF'
#!/usr/bin/env bash
# Fake @hasna/paths CLI for the section-19 hermetic probe: answers the
# test-guard state-kind home from S19_RESOLVED. Never touches the real
# resolver and never runs bun.
if [ "$1" = "--app" ] && [ "$2" = "test-guard" ] && [ "$3" = "--kind" ] && [ "$4" = "state" ]; then
  printf '%s\n' "${S19_RESOLVED:-}"
  exit 0
fi
exit 2
EOF
chmod +x "$S19BIN/paths"
s19_probe() {
  {
    printf '%s\n' '#!/usr/bin/env bash'
    sed -n '/^resolve_guard_dir()/,/^}/p' "$1"
    printf '%s\n' 'resolve_guard_dir'
  } > "$2"
  chmod +x "$2"
}
s19_probe "$SEN" "$W19/sentinel-resolve.sh"
s19_probe "$WRAPPER_SOURCE" "$W19/wrapper-resolve.sh"
S19HOME="$W19/home"
mkdir -p "$S19_RESOLVED/slots"
ck "s19 adopted resolved home (sentinel)" "$(S19_RESOLVED="$S19_RESOLVED" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/sentinel-resolve.sh" 2>/dev/null)" "$S19_RESOLVED"
ck "s19 adopted resolved home (wrapper)" "$(S19_RESOLVED="$S19_RESOLVED" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/wrapper-resolve.sh" 2>/dev/null)" "$S19_RESOLVED"
rm -rf "$S19_RESOLVED"
ck "s19 not-adopted resolved home -> legacy (sentinel)" "$(S19_RESOLVED="$S19_RESOLVED" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/sentinel-resolve.sh" 2>/dev/null)" "$S19HOME/.hasna/test-guard"
ck "s19 not-adopted resolved home -> legacy (wrapper)" "$(S19_RESOLVED="$S19_RESOLVED" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/wrapper-resolve.sh" 2>/dev/null)" "$S19HOME/.hasna/test-guard"
mkdir -p "$S19_RESOLVED"   # exists but empty — no guard state, not adopted
ck "s19 empty resolved home NOT adopted (sentinel)" "$(S19_RESOLVED="$S19_RESOLVED" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/sentinel-resolve.sh" 2>/dev/null)" "$S19HOME/.hasna/test-guard"
ck "s19 empty resolved home NOT adopted (wrapper)" "$(S19_RESOLVED="$S19_RESOLVED" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/wrapper-resolve.sh" 2>/dev/null)" "$S19HOME/.hasna/test-guard"
ck "s19 HASNA_STATE_HOME adopts resolved home (sentinel)" "$(S19_RESOLVED="$S19_RESOLVED" HASNA_STATE_HOME="$S19HOME/state-root" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/sentinel-resolve.sh" 2>/dev/null)" "$S19_RESOLVED"
ck "s19 HASNA_STATE_HOME adopts resolved home (wrapper)" "$(S19_RESOLVED="$S19_RESOLVED" HASNA_STATE_HOME="$S19HOME/state-root" PATH="$S19BIN:$PATH" HOME="$S19HOME" "$W19/wrapper-resolve.sh" 2>/dev/null)" "$S19_RESOLVED"
rm -rf "$S19_RESOLVED"
ck "s19 no-resolver falls back to legacy (sentinel)" "$(PATH="/usr/bin:/bin" HOME="$S19HOME" "$W19/sentinel-resolve.sh" 2>/dev/null)" "$S19HOME/.hasna/test-guard"
ck "s19 no-resolver falls back to legacy (wrapper)" "$(PATH="/usr/bin:/bin" HOME="$S19HOME" "$W19/wrapper-resolve.sh" 2>/dev/null)" "$S19HOME/.hasna/test-guard"

echo "=== battery: $pass PASS, $failn FAIL"
rm -rf "$W"
exit "$failn"
