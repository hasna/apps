#!/bin/sh
#
# trash-guard-hook.sh — the PreToolUse hook fixture the live proof wires into a
# FRESHLY STARTED session.
#
# This file is the §11.5 contract written out, and it is deliberately built so
# that it can only ever degrade in the safe direction:
#
#   no delete verb in command position     -> exit 0, emit NOTHING (allow)
#   trash binary missing / unusable        -> self-contained DENY (exit 2)
#   trash present, plan says `rewrite`     -> emit the complete updatedInput
#   trash present, plan says `deny`        -> exit 2 with the plan's reason
#   anything the hook cannot parse         -> self-contained DENY (exit 2)
#
# "Degrades redirect -> block, never redirect -> allow" (§11.5) is the whole
# reason the sniff below exists: the authoritative decision comes from the
# `trash` binary, but its ABSENCE must not turn a delete into a pass-through.
#
# Configuration travels in the COMMAND TEXT of the settings.json hook entry —
# `--spool <abs> --trash <abs> --log <abs>` — never through the environment.
# A variable set in the hook child does not reach the process that later runs
# the rewritten command (§4, "two-context resolution"); command text does.
#
# ---------------------------------------------------------------------------
# WHAT THIS FIXTURE IS NOT
# ---------------------------------------------------------------------------
# It is NOT the shipped hook. §11.5 puts the shipped guard in `@hasna/hooks` as
# `hook-trash-guard`, and that entry point does not exist in this tree yet. The
# proof wires THIS file so that the trash-side decision path (scan -> plan ->
# rewrite) is exercised by a real Bash tool call end to end. The rewrite it
# emits is byte-for-byte the one `trash guard --plan` produced; the proof never
# invents a command of its own. When `hook-trash-guard` lands, this fixture is
# replaced by it and the proof's wiring checks are unchanged.
#
# `set -e` is deliberately ABSENT. §12: "`set -euo pipefail` turns a
# hook-internal error into a silent allow" — every status below is handled
# explicitly, and the failure branch is a denial, not a fall-through.

SPOOL=""
TRASH=""
LOG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --spool) SPOOL="${2:-}"; shift 2 ;;
    --trash) TRASH="${2:-}"; shift 2 ;;
    --log)   LOG="${2:-}";   shift 2 ;;
    *)
      echo "trash-guard-hook: unknown argument '$1' (expected --spool/--trash/--log)" >&2
      exit 2
      ;;
  esac
done

if [ -z "$SPOOL" ] || [ -z "$TRASH" ] || [ -z "$LOG" ]; then
  echo "trash-guard-hook: --spool, --trash and --log are all required" >&2
  exit 2
fi

payload=$(cat)

# The one and only delete-verb sniff, used ONLY when the authoritative scanner
# is unavailable. SANCTIONED: this line defines a PATTERN; it invokes nothing.
SNIFF_RE='(^|[;&|(][[:space:]]*|[[:space:]])(rm|rmdir|unlink|shred)[[:space:]]' # SANCTIONED

emit_log() {
  # $1 decision, $2 reason, $3 rewritten command ("" when none)
  # Built entirely inside jq so every field is JSON-escaped exactly once.
  jq -nc \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg tool "$tool" \
    --arg command "$cmd" \
    --arg cwd "$cwd" \
    --arg decision "$1" \
    --arg reason "$2" \
    --arg rewritten "$3" \
    --arg trash "$resolved" \
    '{at:$at,tool:$tool,command:$command,cwd:$cwd,decision:$decision,reason:$reason,rewritten:$rewritten,trash:$trash}' \
    >> "$LOG" 2>/dev/null
  return 0
}

deny() {
  emit_log "deny" "$1" ""
  printf 'trash guard: %s\n' "$1" >&2
  exit 2
}

# ---------------------------------------------------------------- read input
tool=$(printf '%s' "$payload" | jq -r '.tool_name // ""' 2>/dev/null)
jrc=$?
[ "$jrc" -eq 0 ] || deny "the hook could not parse its input payload, so it cannot tell what is being deleted"

# Wave 1 is Bash-only (§11.9); every other tool is none of this hook's business.
[ "$tool" = "Bash" ] || exit 0

# A command we cannot READ is a payload we cannot verify. `.tool_input.command
# // ""` collapses "cannot read" and "present but empty" into one value, and jq
# succeeds on both -- so the `// ""` default alone would let an unreadable
# payload fall through as "no delete verb", i.e. ALLOW. The harness falls back
# to the ORIGINAL tool input whenever `updatedInput` is missing or empty, so
# "cannot tell" must never resolve to "run it". Test readability with `jq -e`
# BEFORE defaulting: a present-but-empty string still passes (it runs nothing,
# and is correctly allowed), while a missing / null / non-string command is
# refused.
if ! printf '%s' "$payload" | jq -e '(.tool_input? | type) == "object" and (.tool_input.command? | type) == "string"' >/dev/null 2>&1; then
  deny "the hook could not read a string tool_input.command from its input payload, so it cannot verify what would run — refusing rather than allowing an unverifiable call. Re-run the delete explicitly as \`rm -- <path>\`."
fi
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)
jrc=$?
[ "$jrc" -eq 0 ] || deny "the hook could not read tool_input.command from its input payload"
cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null)

resolved=$(command -v trash 2>/dev/null || printf '')

# ------------------------------------------- self-contained refusal (no trash)
if [ ! -x "$TRASH" ]; then
  if printf '%s' "$cmd" | grep -Eq "$SNIFF_RE"; then
    deny "the trash guard is not installed at $TRASH, so this delete cannot be made recoverable — refusing it rather than running it. Install @hasna/trash and retry, or delete by hand if you truly mean it."
  fi
  exit 0
fi

# ----------------------------------------------------- authoritative decision
plan=$(command "$TRASH" guard --spool "$SPOOL" --plan "$cmd" 2>/dev/null)
prc=$?

if [ "$prc" -ne 0 ] && [ "$prc" -ne 2 ]; then
  # The scanner itself failed. Fail closed for a delete, pass everything else.
  if printf '%s' "$cmd" | grep -Eq "$SNIFF_RE"; then
    deny "the trash guard exited $prc without producing a decision, so the hook cannot prove this delete is recoverable — refusing it."
  fi
  exit 0
fi

decision=$(printf '%s' "$plan" | jq -r '.decision // ""' 2>/dev/null)
jrc=$?
[ "$jrc" -eq 0 ] || deny "the trash guard produced a decision the hook could not parse"
rewritten=$(printf '%s' "$plan" | jq -r '.command // ""' 2>/dev/null)
reason=$(printf '%s' "$plan" | jq -r '.reason // ""' 2>/dev/null)

case "$decision" in
  allow)
    emit_log "allow" "$reason" ""
    exit 0
    ;;

  deny)
    deny "$reason"
    ;;

  rewrite)
    # A COMPLETE rewrite of the entire tool_input, or nothing at all: the
    # harness falls back to the ORIGINAL input when updatedInput is missing or
    # empty (§15 correction 3), and the original input here is a live `rm`.
    description=$(printf '%s' "$payload" | jq -r '.tool_input.description // ""' 2>/dev/null)
    timeout=$(printf '%s' "$payload" | jq -r '.tool_input.timeout // 120000' 2>/dev/null)
    background=$(printf '%s' "$payload" | jq -r '.tool_input.run_in_background // false' 2>/dev/null)
    case "$timeout" in ''|*[!0-9]*) timeout=120000 ;; esac
    case "$background" in true|false) ;; *) background=false ;; esac

    if [ -z "$rewritten" ]; then
      deny "the trash guard reported a rewrite with an empty command, which the harness would discard and run the original delete instead"
    fi

    out=$(jq -nc \
      --arg c "$rewritten" \
      --arg d "$description" \
      --argjson t "$timeout" \
      --argjson b "$background" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:{command:$c,description:$d,timeout:$t,run_in_background:$b}}}')
    orc=$?
    [ "$orc" -eq 0 ] || deny "the hook could not serialise the rewrite, so it refuses rather than letting the original delete run"

    emit_log "rewrite" "$reason" "$rewritten"
    printf '%s\n' "$out"
    exit 0
    ;;

  *)
    # An empty or unknown decision is not an allow.
    if printf '%s' "$cmd" | grep -Eq "$SNIFF_RE"; then
      deny "the trash guard returned an unrecognised decision ('$decision') for a delete — refusing it."
    fi
    exit 0
    ;;
esac
