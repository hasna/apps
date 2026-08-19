#!/usr/bin/env bash
# test_session_inject_gate.sh — A3 fail-closed cursor-restore regression (todos 996bf5bc).
#
# Fixture 1 (intermediate exit): a manifest missing .monitor.target.session_id makes
#   the gate exit BETWEEN the reader pass and the injector. The reader has already
#   advanced the cursor; the gate MUST restore the pre-pass snapshot so the
#   undelivered content re-fires on the next firing.
# Positive control: a clean inject (steer-turn readback OK, strong discriminator)
#   leaves cursors advanced — delivery confirmed, no restore.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$SCRIPTS_DIR/hasna-session-inject-gate.sh"
READER="$SCRIPTS_DIR/src-command.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/sim-a3.XXXXXX")"
trap 'rm -rf "$T"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()  { echo "ok: $*"; }

# feeds: v1 = baseline content, v2 = new content (hash differs)
printf 'alpha\n' > "$T/feed-v1.txt"
printf 'alpha\nbeta\n' > "$T/feed-v2.txt"
H1="$(sha256sum "$T/feed-v1.txt" | awk '{print $1}')"
H2="$(sha256sum "$T/feed-v2.txt" | awk '{print $1}')"
[[ "$H1" != "$H2" ]] || fail "fixture feeds must differ"

CURDIR="$T/cursor"
CUR="$CURDIR/a3test.chk.cursor"
mkdir -p "$CURDIR"

# baseline the cursor (reader first-run semantics: stores the hash, emits nothing)
SIM_CURSOR_FILE="$CUR" SIM_COMMAND="cat $T/feed-v1.txt" "$READER" > "$T/base.out" 2> "$T/base.err"
[[ "$(cat "$CUR")" == "$H1" ]] || fail "baseline cursor not stored"
[[ ! -s "$T/base.out" ]] || fail "baseline emitted output"

# ---------- Fixture 1: exit between reader pass and inject (missing session_id) ----------
cat > "$T/manifest-missing-session.yaml" <<YAML
monitor:
  name: a3test
  cursor_dir: "$CURDIR"
  sources:
    - kind: command
      label: chk
      args:
        command: "cat $T/feed-v2.txt"
  target:
    runtime: opencode2
YAML

set +e
"$GATE" --manifest "$T/manifest-missing-session.yaml" > "$T/f1.out" 2> "$T/f1.err"
F1_RC=$?
set -e
[[ "$F1_RC" -eq 2 ]] || fail "fixture1: expected gate rc=2 (missing session_id), got rc=$F1_RC"
after="$(cat "$CUR" 2>/dev/null || echo MISSING)"
[[ "$after" == "$H1" ]] || fail "fixture1: cursor NOT restored (got '$after', want '$H1') — undelivered content would be marked delivered"
ok "fixture1: intermediate exit restored cursor (content re-fires next firing)"

# ---------- Positive control: clean inject leaves cursor advanced ----------
cat > "$T/fake-opencode2.sh" <<'EOF'
#!/usr/bin/env bash
# fake opencode2: return a delivered steer-turn readback for the -d body it receives
body=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d) body="$2"; shift 2 ;;
    *) shift ;;
  esac
done
python3 - "$body" <<'PY'
import json, sys
b = json.loads(sys.argv[1])
print(json.dumps({"data": {"type": "user", "delivery": "steer", "payload": {"text": b.get("text", "")}}}))
PY
EOF
chmod +x "$T/fake-opencode2.sh"

CURC="$CURDIR/a3ctl.chk.cursor"
SIM_CURSOR_FILE="$CURC" SIM_COMMAND="cat $T/feed-v1.txt" "$READER" > /dev/null
[[ "$(cat "$CURC")" == "$H1" ]] || fail "control baseline cursor not stored"

cat > "$T/manifest-clean.yaml" <<YAML
monitor:
  name: a3ctl
  cursor_dir: "$CURDIR"
  sources:
    - kind: command
      label: chk
      args:
        command: "cat $T/feed-v2.txt"
  target:
    runtime: opencode2
    session_id: sess-1
YAML

set +e
SIM_OPCODE2_CMD="$T/fake-opencode2.sh" \
  "$GATE" --manifest "$T/manifest-clean.yaml" > "$T/ctl.out" 2> "$T/ctl.err"
CTL_RC=$?
set -e
[[ "$CTL_RC" -eq 0 ]] || fail "control: gate rc=$CTL_RC (stderr: $(head -c 200 "$T/ctl.err"))"
after2="$(cat "$CURC" 2>/dev/null || echo MISSING)"
[[ "$after2" == "$H2" ]] || fail "control: cursor not advanced after clean inject (got '$after2', want '$H2')"
ok "control: clean inject left cursor advanced"

echo "ALL PASS"
