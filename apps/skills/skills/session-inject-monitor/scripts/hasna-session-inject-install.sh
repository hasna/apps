#!/usr/bin/env bash
#
# hasna-session-inject-install.sh — installer: parse YAML manifest, baseline
# cursors, arm a carrier (systemd timer | cron | hasna/loops), print what it did.
#
# Declarative + scripted: the YAML manifest names the sources and target; this
# installer maps them onto the reader/injector scripts and the carrier. `--dry-run`
# prints every command it WOULD run and changes nothing.
#
# Usage:
#   hasna-session-inject-install.sh --manifest <file.yaml> \
#       [--carrier systemd|cron|loops] [--cadence <1m|5m|15m|30m|1h|2h>] \
#       [--baseline] [--dry-run]
#
# Carrier status on this fleet (2026-08-19):
#   systemd   [measured] systemctl available; unit + timer files are written under
#             ~/.config/systemd/user/ and enabled with `systemctl --user`.
#   cron      [measured] crontab available; a marked cron line is appended (minute
#             granularity only).
#   loops     [unverified shape] the `loops` CLI is installed (0.1.95 present) but
#             the exact create-loop flags for this gate were NOT measured; the
#             installer REFUSES for loops unless SIM_UNVERIFIED_CARRIER=1, then
#             attempts the best-documented shape and prints the failure guidance.
#
# Env:
#   SIM_UNVERIFIED_CARRIER  1 = allow the unverified loops-carrier shape
#   SIM_CURSOR_DIR          override the manifest cursor_dir
#   SIM_GATE_TIMEOUT        passed through for baselining (default 300)

set -euo pipefail

usage() { sed -n '1,28p' "$0"; }

MANIFEST=""
CARRIER=""
CADENCE=""
DO_BASELINE=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest) MANIFEST="$2"; shift 2 ;;
    --carrier) CARRIER="$2"; shift 2 ;;
    --cadence) CADENCE="$2"; shift 2 ;;
    --baseline) DO_BASELINE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install: unknown arg $1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ -n "$MANIFEST" ]] || { echo "install: --manifest is required" >&2; usage >&2; exit 2; }
MANIFEST="$(realpath "$MANIFEST")"
[[ -f "$MANIFEST" ]] || { echo "install: manifest not found: $MANIFEST" >&2; exit 2; }

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
GATE="$SCRIPTS_DIR/hasna-session-inject-gate.sh"

# ---------- parse manifest with python3 + pyyaml (yq is absent on this box) ----------
TMPW="$(mktemp -d "${TMPDIR:-/tmp}/sim-inst.XXXXXX")"
trap 'rm -rf "$TMPW"' EXIT
JSON="$TMPW/manifest.json"
if ! python3 -c '
import sys, yaml, json
with open(sys.argv[1]) as f: d = yaml.safe_load(f)
if not isinstance(d, dict) or "monitor" not in d: raise SystemExit("manifest root must be a mapping with a monitor key")
with open(sys.argv[2], "w") as f: json.dump(d, f)
' "$MANIFEST" "$JSON" 2> "$TMPW/yaml-err.txt"; then
  cat "$TMPW/yaml-err.txt" >&2
  echo "install: manifest failed to parse" >&2
  exit 2
fi

NAME="$(jq -r '.monitor.name // empty' "$JSON")"
[[ -n "$NAME" ]] || { echo "install: manifest needs monitor.name" >&2; exit 2; }
case "$NAME" in *[!a-zA-Z0-9._-]*) echo "install: monitor.name may only contain [a-zA-Z0-9._-]" >&2; exit 2 ;; esac

CADENCE="${CADENCE:-$(jq -r '.monitor.cadence // "1m"' "$JSON")}"
CARRIER="${CARRIER:-$(jq -r '.monitor.carrier // "systemd"' "$JSON")}"
CURSOR_DIR="${SIM_CURSOR_DIR:-$(jq -r '.monitor.cursor_dir // ""' "$JSON")}"
# Bash never expands `~` inside a variable value: resolve a leading `~/` to $HOME
# so manifests can write `~/.local/state/...` without a literal `~` directory
# (reviewer finding, 2026-08-19).
[[ "$CURSOR_DIR" == '~/'* ]] && CURSOR_DIR="${HOME}/${CURSOR_DIR:2}"
CURSOR_DIR="${CURSOR_DIR:-$HOME/.local/state/session-inject-monitor}"

SRC_COUNT="$(jq '.monitor.sources | length' "$JSON")"
(( SRC_COUNT > 0 )) || { echo "install: manifest needs at least one .monitor.sources[] entry" >&2; exit 2; }
RT="$(jq -r '.monitor.target.runtime // empty' "$JSON")"
SID="$(jq -r '.monitor.target.session_id // empty' "$JSON")"
[[ -n "$RT" && -n "$SID" ]] || { echo "install: manifest needs target.runtime and target.session_id" >&2; exit 2; }

echo "== session-inject-monitor install (dry-run=$( [[ $DRY_RUN == 1 ]] && echo yes || echo no )) =="
echo "  monitor : $NAME"
echo "  sources : $SRC_COUNT -> $(jq -r '[.monitor.sources[].kind] | join(", ")' "$JSON")"
echo "  target  : $RT session=$SID"
echo "  cadence : $CADENCE  carrier: $CARRIER"
echo "  cursors : $CURSOR_DIR"

# ---------- baseline cursors (store current position, inject nothing) ----------
if [[ "$DO_BASELINE" == "1" ]]; then
  echo "  baseline: running gate --baseline (stores cursors only)..."
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "    (dry-run) $GATE --manifest $MANIFEST --baseline"
    echo "    (dry-run) gate in --emit-only mode: $GATE --manifest $MANIFEST --emit-only"
  else
    mkdir -p "$CURSOR_DIR"
    if ! "$GATE" --manifest "$MANIFEST" --baseline; then
      echo "install: baseline failed; fix the readers before arming a carrier" >&2
      exit 2
    fi
    echo "  baseline: cursors stored"
  fi
fi

# ---------- arm carrier ----------
case "$CARRIER" in
  systemd)
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    SERVICE="$UNIT_DIR/sim-$NAME.service"
    TIMER="$UNIT_DIR/sim-$NAME.timer"
    interval="$(case "$CADENCE" in
                 1m|1) echo "1min" ;; 5m|5) echo "5min" ;; 15m|15) echo "15min" ;;
                 30m|30) echo "30min" ;; 1h|1h) echo "1h" ;; 2h|2h) echo "2h" ;;
                 *) echo "INVALID" ;; esac)"
    [[ "$interval" != "INVALID" ]] || { echo "install: unsupported cadence '$CADENCE' for systemd (1m|5m|15m|30m|1h|2h)" >&2; exit 2; }
    if [[ "$DRY_RUN" == "1" ]]; then
      cat <<EOF
(dry-run) would write:
  $SERVICE
[Unit]
Description=session-inject-monitor: $NAME
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $GATE --manifest $MANIFEST
Nice=10

  $TIMER
[Unit]
Description=session-inject-monitor timer: $NAME

[Timer]
OnUnitActiveSec=$interval
AccuracySec=1s

[Install]
WantedBy=timers.target

(dry-run) systemctl --user daemon-reload
(dry-run) systemctl --user enable --now sim-$NAME.timer
EOF
    else
      mkdir -p "$UNIT_DIR"
      cat > "$SERVICE" <<EOF
[Unit]
Description=session-inject-monitor: $NAME
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $GATE --manifest $MANIFEST
Nice=10
EOF
      cat > "$TIMER" <<EOF
[Unit]
Description=session-inject-monitor timer: $NAME

[Timer]
OnUnitActiveSec=$interval
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF
      systemctl --user daemon-reload
      systemctl --user enable --now "sim-$NAME.timer" >/dev/null
      echo "  armed  : systemctl --user list-timers sim-$NAME.timer"
      echo "  units  : $SERVICE"
      echo "          $TIMER"
    fi
    ;;

  cron)
    minutes="$(case "$CADENCE" in
               1m|1) echo "*/1" ;; 5m|5) echo "*/5" ;; 15m|15) echo "*/15" ;;
               30m|30) echo "*/30" ;; 1h|1h) echo "0" ;; 2h|2h) echo "0 */2" ;;
               *) echo "INVALID" ;; esac)"
    [[ "$minutes" != "INVALID" ]] || { echo "install: unsupported cadence '$CADENCE' for cron (minute granularity: 1m|5m|15m|30m|1h|2h)" >&2; exit 2; }
    line="$minutes * * * * /usr/bin/env bash $GATE --manifest $MANIFEST # sim-$NAME"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "(dry-run) crontab append: $line"
    else
      if crontab -l 2>/dev/null | grep -Fq "sim-$NAME"; then
        echo "  cron   : marker sim-$NAME already present; leaving crontab untouched"
      else
        ( crontab -l 2>/dev/null || true; echo "$line" ) | crontab -
        echo "  armed  : crontab entry added: $line"
        echo "  marker : sim-$NAME"
      fi
    fi
    ;;

  loops)
    if [[ "${SIM_UNVERIFIED_CARRIER:-0}" != "1" ]]; then
      cat >&2 <<'EOF'
install: REFUSED for carrier=loops.

The `loops` CLI is installed, but the exact create-loop shape for this gate was
NOT measured on this fleet, and arming a carrier with a fabricated command would
fail silently or create the wrong thing. Reroute to carrier=systemd or cron
(verified), or set SIM_UNVERIFIED_CARRIER=1 to attempt the best-documented shape:
  loops create --name sim-<name> --command "bash $GATE --manifest $MANIFEST" --schedule "<cadence>"
EOF
      exit 2
    fi
    echo "  loops  : SIM_UNVERIFIED_CARRIER=1 set — attempting best-documented shape (UNVERIFIED)"
    loops_create_cmd="loops create --name sim-$NAME --command \"bash $GATE --manifest $MANIFEST\" --schedule $CADENCE"
    if [[ "$DRY_RUN" == "1" ]]; then
      echo "  (dry-run) $loops_create_cmd"
    else
      echo "  running: $loops_create_cmd"
      # shellcheck disable=SC2086
      eval "$loops_create_cmd" || { echo "install: loops create failed; capture its stderr and adapt the shape, or use carrier=systemd" >&2; exit 2; }
    fi
    ;;
  *)
    echo "install: unknown carrier '$CARRIER' (systemd|cron|loops)" >&2
    exit 2
    ;;
esac

# ---------- summary ----------
cat <<EOF

== install summary ==
  manifest : $MANIFEST
  gate cmd : $GATE --manifest $MANIFEST
  cursors  : $CURSOR_DIR/<monitor>.<label>.cursor
  log file : $CURSOR_DIR/monitor.log
  verify   : run '$GATE --manifest $MANIFEST --emit-only' once by hand;
             confirm the carrier's run record shows a REAL firing before trusting
             silence (a status or next-run timestamp proves nothing).
EOF
exit 0