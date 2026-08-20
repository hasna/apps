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
rc=$(cd "$W/suite" && systemd-run --user --scope --quiet --collect \
  -p MemoryHigh=12G -p MemoryMax=16G -p MemorySwapMax=0 -p TasksMax=4096 \
  -- env HASNA_TEST_GUARD_DIR="$W/g4" HASNA_TEST_GUARD_HELD=1 "$B" test >/dev/null 2>&1; echo $?)
ck "bounded nested HELD runs without reacquiring" "$rc" "0"
rc=$(cd "$W/suite" && BUN_TEST_CGROUP_ASSERT_SKIP=1 HASNA_TEST_GUARD_DIR="$W/g4" HASNA_TEST_GUARD_BYPASS=1 $B test >/dev/null 2>&1; echo $?)
ck "BYPASS runs" "$rc" "0"
wait

# 8 a finite but loose outer scope must not be trusted as the fleet scope
mkdir -p "$W/g-loose/slots"
rc=$(cd "$W/suite" && systemd-run --user --scope --quiet --collect \
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
# the installed source of truth.
cp "$B" "$W/marker-preserving-wrapper"
printf '\n# marker-preserving tamper\n' >> "$W/marker-preserving-wrapper"
chmod +x "$W/marker-preserving-wrapper"
ck "sentinel detects marker-preserving tamper" "$(SENTINEL_DRY_RUN=1 "$SEN" "$W/marker-preserving-wrapper" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"

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
ck "sentinel pass" "$("$SEN" "$B" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "0"
ck "sentinel detects unscoped wrapper" "$(SENTINEL_DRY_RUN=1 "$SEN" /home/hasna/.bun/bin/bun.pre-ce9c2402 "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"
ck "sentinel marker tamper" "$(SENTINEL_DRY_RUN=1 "$SEN" "$BR" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"
mkdir -p "$W/g6/slots" "$W/g6/queue"; : > "$W/g6/queue/not-a-ticket"
ck "sentinel junk survives" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g6" "$SEN" "$B" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "0"
: > "$W/g6/queue/$(( $(date +%s%N) - 2200000000000 )).$$"
ck "sentinel wedge alerts" "$(SENTINEL_DRY_RUN=1 SENTINEL_GUARD_DIR="$W/g6" "$SEN" "$B" "$WRAPPER_SOURCE" >/dev/null 2>&1; echo $?)" "1"

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
# wrapper-missing (marker gone) is the one state where NOT ENGAGED is correct
s_rc=$(SENTINEL_DRY_RUN=1 "$SEN" /home/hasna/.bun/bin/bun.pre-ce9c2402 "$WRAPPER_SOURCE" > "$S16/out" 2> "$S16/err"; echo $?)
ck "s16 wrapper-missing sentinel still fails" "$s_rc" "1"
ck "s16 wrapper-missing alert says NOT ENGAGED" "$(grep -c 'NOT ENGAGED' "$S16/out")" "1"

echo "=== battery: $pass PASS, $failn FAIL"
rm -rf "$W"
exit "$failn"
