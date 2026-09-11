#!/usr/bin/env bash
#
# trash-live-proof.sh — the live proof for @hasna/trash (plan §10, phase-2 gate).
#
# WHAT THIS PROVES, WITH LIVE COMMANDS AND NOT WITH UNIT TESTS
#
#   (a) the PreToolUse hook FIRES on a real Bash tool call and rewrites a live
#       delete into `trash guard` BEFORE it executes;
#   (b) the intercepted delete lands in the trash store;
#   (c) `trash list` shows it;
#   (d) `trash restore` returns it BYTE-IDENTICAL — sha256 and mode per file,
#       mode per dir, symlink target — and restores by MOVING, not copying;
#   (e) the intercepted command's exit code is the one the real deleter would
#       have returned, measured against a real oracle on a twin fixture, plus a
#       parity table over the deleter's own grammar.
#
# and the negative controls that make those five worth anything: an unrestored
# control, a real-delete twin with NO store entry, the guard refusing the
# protected class, the guard refusing the sibling-prefix canary, the outside
# canary surviving every checkpoint, and the operator's real store untouched.
#
# THE FIXTURE DECISION THAT MATTERS MOST
#
#   SANDBOX_ROOT = mktemp -d /tmp/trash-live-proof.XXXXXXXX
#   CANARY_DIR   = "${SANDBOX_ROOT}-canary"      <- a STRING-PREFIX SIBLING
#
# The canary is outside the sandbox but IS a string prefix of it, so a
# containment check written as [[ $p == $root* ]] — without the trailing
# separator — wrongly accepts it. The proof asserts BOTH that the real
# containment check refuses it AND that the naive form would have accepted it.
# Without that second assertion the fixture would prove nothing.
#
# THE CHOKE POINT
#
#   sandbox_target() is the single gate every destructive call passes through,
#   the real-delete oracle included. It refuses absolute paths, globs, traversal
#   components and trailing slashes, refuses a root that is not under a temp
#   dir, and refuses any resolved path that is not under "$root"/ WITH the
#   separator.
#
# THE SELF-AUDIT (three rules, all three enforced before any fixture exists)
#
#   A. a non-comment line must not name a delete verb in command position
#      unless it is inside a sanctioned wrapper body or marked SANCTIONED;
#   B. every invocation of the trash binary must carry `--spool`, so it can
#      never reach the operator's real store;
#   C. the real deleter appears exactly twice, both inside `rm_oracle`.
#
#   Comment lines are reported and exempt, on the plain ground that a comment
#   cannot execute. Every other line is counted, and the counts are printed.
#
# TEARDOWN: THERE IS NONE, DELIBERATELY
#
#   The sandbox is left in place. A cleanup step is a second chance to delete
#   the wrong thing and the step most likely to run against an unset variable.
#   This script contains no delete of its own: the only deletions in the run are
#   fixtures it created, through the guard or through the oracle, both behind
#   sandbox_target.
#
# EVERY READ IS `jq -e`: a read that produces no evidence is a FAILURE, never a
# skip. The last line of the run is exactly one of
#
#   PROOF: GO - <n> checks, <m> live commands, sandbox=<path>
#   PROOF: NO_GO - rc=<code> <reason>
#
# Exit codes: 10 self-audit · 11 sandbox/choke point · 12 hook wiring ·
#             13 capture · 14 list · 15 restore · 16 exit-code parity ·
#             17 negative control · 18 canary · 19 real store · 20 evidence ·
#             21 exited early · 22 environment (missing build, missing claude)

set -uo pipefail
# `set -e` is deliberately OFF: this script is built on explicit status
# handling, and §12 records that shell error options are the thing that turns a
# hook-internal error into a silent allow.

EXIT_AUDIT=10
EXIT_SANDBOX=11
EXIT_WIRING=12
EXIT_CAPTURE=13
EXIT_LIST=14
EXIT_RESTORE=15
EXIT_ECPARITY=16
EXIT_NEGATIVE=17
EXIT_CANARY=18
EXIT_REALSTORE=19
EXIT_EVIDENCE=20
EXIT_EARLY=21
EXIT_ENV=22

PROOF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF="$PROOF_DIR/trash-live-proof.sh"
HOOK_FILE="$PROOF_DIR/trash-guard-hook.sh"
REPO_ROOT="$(cd "$PROOF_DIR/.." && pwd)"
DIST_CLI="$REPO_ROOT/apps/trash/dist/cli/index.js"
DIST_INDEX="$REPO_ROOT/apps/trash/dist/index.js"

PASSED=0
LIVE=0
RC=0
TERMINAL_LINE=""
status_ok=0

# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

finish() {
  local rc=$?
  if [ -n "$TERMINAL_LINE" ]; then
    printf '%s\n' "$TERMINAL_LINE"
    return 0
  fi
  if [ "$status_ok" -eq 1 ]; then
    printf 'PROOF: GO - %d checks, %d live commands, sandbox=%s\n' "$PASSED" "$LIVE" "$SANDBOX_ROOT"
    return 0
  fi
  printf 'PROOF: NO_GO - rc=%d the proof exited with status %d before it reached a verdict\n' "$EXIT_EARLY" "$rc"
  return 0
}
trap finish EXIT

pass() {
  PASSED=$((PASSED + 1))
  printf 'PASS  %-30s | %s\n' "$1" "$2"
}

fail() { # fail <exit-code> <check-name> <evidence>
  printf 'FAIL  %-30s | %s\n' "$2" "$3"
  TERMINAL_LINE="PROOF: NO_GO - rc=$1 $2: $3"
  exit "$1"
}

count_live() { LIVE=$((LIVE + 1)); }

run_live() { # run_live <cmd...> -> RC; counts the command as live
  count_live
  "$@"
  RC=$?
  return 0
}

# Every JSON read goes through this, and a read that yields nothing fails.
expect_jq() { # expect_jq <exit-code> <check-name> <file> <jq-filter> [jq-args...]
  local code="$1" name="$2" file="$3" filter="$4"
  shift 4
  local out
  if [ ! -f "$file" ]; then
    fail "$code" "$name" "evidence file $file does not exist"
  fi
  out=$(jq -e "$@" "$filter" < "$file" 2>/dev/null)
  if [ "$?" -ne 0 ]; then
    fail "$code" "$name" "jq -e on $(basename "$file") produced no evidence: '$filter'"
  fi
  pass "$name" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-150)"
}

jqr() { # jqr <file> <filter> [jq-args...]
  local file="$1" filter="$2"
  shift 2
  jq -r "$@" "$filter" < "$file" 2>/dev/null
}

# ==========================================================================
# SELF-AUDIT — first, before a single fixture exists
# ==========================================================================

# SANCTIONED: this line defines a PATTERN over delete verbs; it invokes nothing.
DELETE_PAT='(^|[^[:alnum:]_])(rm|rmdir|unlink|shred)([^[:alnum:]_-]|$)|-delete([^[:alnum:]_-]|$)' # SANCTIONED
# SANCTIONED: the invocation reference itself — a PATTERN, never a call.
TRASH_REF='$TRASH_BIN' # SANCTIONED
TRASH_INVOKE_PAT='\$TRASH(_BIN)?"[[:space:]]+(guard|list|restore|put|purge|empty|status|info|doctor|config|sweep)'
# SANCTIONED: a PATTERN matching an absolute invocation of the real deleter.
ORACLE_PAT='^[[:space:]]*/usr/bin/'

SANCTIONED_BODIES="rm_oracle trash_guard trash_cli"
BODY_RANGES=""

body_range() { # body_range <file> <function-name> -> "start end"
  local file="$1" fn="$2" start end
  start=$(grep -nE "^${fn}\(\) *\{" "$file" | head -1 | cut -d: -f1)
  [ -n "$start" ] || return 1
  end=$(awk -v s="$start" 'NR > s && $0 == "}" { print NR; exit }' "$file")
  [ -n "$end" ] || return 1
  printf '%s %s\n' "$start" "$end"
}

body_lines() { # body_lines <file> <function-name>
  local r
  r=$(body_range "$1" "$2") || return 1
  sed -n "$(printf '%s' "$r" | tr ' ' ',')p" "$1"
}

in_sanctioned_body() { # in_sanctioned_body <line-number-in-SELF>
  local n="$1" s e
  set -- $BODY_RANGES
  while [ $# -ge 2 ]; do
    s=$1; e=$2; shift 2
    if [ "$n" -ge "$s" ] && [ "$n" -le "$e" ]; then return 0; fi
  done
  return 1
}

AUDIT_REPORT=""
AUDIT_OFFENDERS=0
AUDIT_MARKED=0
AUDIT_COMMENTS=0
AUDIT_INBODY=0
AUDIT_SPOOLED=0
AUDIT_TRASH_LINES=0

audit_deleter_lines() { # rule A over one file
  local file="$1" label="$2" line num text trim
  while IFS= read -r line; do
    num="${line%%:*}"
    text="${line#*:}"
    trim="${text#"${text%%[![:space:]]*}"}"
    case "$trim" in '#'*) AUDIT_COMMENTS=$((AUDIT_COMMENTS + 1)); continue ;; esac
    case "$text" in *SANCTIONED*) AUDIT_MARKED=$((AUDIT_MARKED + 1)); continue ;; esac
    if [ "$file" = "$SELF" ] && in_sanctioned_body "$num"; then
      AUDIT_INBODY=$((AUDIT_INBODY + 1)); continue
    fi
    AUDIT_OFFENDERS=$((AUDIT_OFFENDERS + 1))
    AUDIT_REPORT="$AUDIT_REPORT
  UNMARKED delete path  $label:$num  $trim"
  done < <(grep -nE "$DELETE_PAT" "$file" 2>/dev/null)
}

audit_trash_invocations() { # rule B over one file
  local file="$1" label="$2" line num text trim
  while IFS= read -r line; do
    num="${line%%:*}"
    text="${line#*:}"
    trim="${text#"${text%%[![:space:]]*}"}"
    case "$trim" in '#'*) AUDIT_COMMENTS=$((AUDIT_COMMENTS + 1)); continue ;; esac
    AUDIT_TRASH_LINES=$((AUDIT_TRASH_LINES + 1))
    case "$text" in
      *--spool*) AUDIT_SPOOLED=$((AUDIT_SPOOLED + 1)) ;;
      *SANCTIONED*) AUDIT_MARKED=$((AUDIT_MARKED + 1)) ;;
      *)
        AUDIT_OFFENDERS=$((AUDIT_OFFENDERS + 1))
        AUDIT_REPORT="$AUDIT_REPORT
  UNMARKED trash call   $label:$num  $trim"
        ;;
    esac
  done < <(grep -nE "$TRASH_INVOKE_PAT" "$file" 2>/dev/null)
}

printf '== self-audit ==\n'
for fn in $SANCTIONED_BODIES; do
  r=$(body_range "$SELF" "$fn") || fail "$EXIT_AUDIT" "self-audit" "the sanctioned wrapper '$fn' is not defined in $SELF"
  BODY_RANGES="$BODY_RANGES $r"
done

audit_deleter_lines "$SELF" "proof"
audit_deleter_lines "$HOOK_FILE" "hook"
audit_trash_invocations "$SELF" "proof"
audit_trash_invocations "$HOOK_FILE" "hook"

# Rule C, stated separately because it is the one that would matter most.
BIN_LINES="$(grep -nE "$ORACLE_PAT" "$SELF" | cut -d: -f1 | tr '\n' ' ')"
BIN_COUNT="$(printf '%s' "$BIN_LINES" | tr ' ' '\n' | grep -c .)"
[ "$BIN_COUNT" = "2" ] || fail "$EXIT_AUDIT" "self-audit-rule-C" "absolute invocations of the real deleter: $BIN_COUNT in $SELF, expected exactly 2 (one per flavour of invocation)"
BIN_IN_BODY=0
for n in $BIN_LINES; do
  if in_sanctioned_body "$n"; then BIN_IN_BODY=$((BIN_IN_BODY + 1)); fi
done
[ "$BIN_IN_BODY" = "2" ] || fail "$EXIT_AUDIT" "self-audit-rule-C" "only $BIN_IN_BODY of the $BIN_COUNT absolute invocations are inside a sanctioned wrapper body"

for fn in rm_oracle trash_guard; do
  if ! body_lines "$SELF" "$fn" | grep -q 'sanitize_targets'; then
    fail "$EXIT_AUDIT" "self-audit-rule-C" "$fn does not route its operands through sanitize_targets"
  fi
done
if ! body_lines "$SELF" trash_cli | grep -q -- '--spool'; then
  fail "$EXIT_AUDIT" "self-audit-rule-B" "trash_cli does not carry --spool"
fi

[ -z "$AUDIT_REPORT" ] || printf '%s\n' "$AUDIT_REPORT"
if [ "$AUDIT_OFFENDERS" != "0" ]; then
  fail "$EXIT_AUDIT" "self-audit" "$AUDIT_OFFENDERS unmarked delete path(s) or unsandboxed trash invocation(s) — listed above"
fi
pass "self-audit-rule-A" "$AUDIT_INBODY delete-verb line(s) inside a sanctioned wrapper; $AUDIT_MARKED line(s) marked SANCTIONED as patterns or names; $AUDIT_COMMENTS comment line(s) exempt (a comment cannot execute); 0 unmarked"
pass "self-audit-rule-B" "$AUDIT_SPOOLED trash invocation(s) carry --spool; $AUDIT_TRASH_LINES line(s) reviewed across the proof and the hook"
pass "self-audit-rule-C" "the real deleter appears exactly $BIN_COUNT times, both inside rm_oracle; rm_oracle and trash_guard both route through sanitize_targets"

# ==========================================================================
# The choke point
# ==========================================================================

SANDBOX_REFUSAL=""

refuse() { # refuse <reason>
  SANDBOX_REFUSAL="$1"
  return 1
}

sandbox_contains() { # sandbox_contains <root> <absolute-candidate>
  local root="$1" candidate="$2"
  [ -n "$root" ] || return 1
  [ -n "$candidate" ] || return 1
  case "$root" in
    "${TMPDIR:-/tmp}/"?*) ;;
    *) return 1 ;;
  esac
  [ -d "$root" ] || return 1
  [ "$candidate" = "$root" ] && return 1 # the root itself is not "under" the root
  case "$candidate" in
    "$root"/*) return 0 ;; # WITH the separator — the line the canary exists for
  esac
  return 1
}

sandbox_target() { # sandbox_target <root> <relative-path> -> the validated absolute path
  local root="$1" rel="${2:-}" canon abs
  [ -n "$rel" ] || { refuse "an empty path"; return 1; }
  case "$rel" in /*) refuse "an absolute path ($rel)"; return 1 ;; esac
  case "$rel" in *'*'*|*'?'*|*'['*|*']'*) refuse "a glob ($rel)"; return 1 ;; esac
  case "/$rel/" in *'/../'*) refuse "a traversal component ($rel)"; return 1 ;; esac
  case "/$rel/" in *'/./'*) refuse "a redundant dot component ($rel)"; return 1 ;; esac
  case "$rel" in */) refuse "a trailing slash ($rel)"; return 1 ;; esac

  # The root must be NAMED CANONICALLY. A root that reaches its directory
  # through `..` or through a symlink is not a root this gate can say anything
  # about: `<sandbox>/../<sandbox>-canary` string-matches a prefix check while
  # pointing somewhere else entirely — which is how a target walks out of the
  # sandbox while every other check here still passes. The first live run
  # accepted exactly that, and the fixture caught it.
  canon=$(cd "$root" 2>/dev/null && pwd -P)
  [ -n "$canon" ] || { refuse "a SANDBOX_ROOT that cannot be resolved ($root)"; return 1; }
  [ "$canon" = "$root" ] || { refuse "a SANDBOX_ROOT that is not canonical (given $root, resolves to $canon)"; return 1; }

  # One sandbox, pinned. The gate refuses to operate under any other root, so
  # no call site can redirect it at a directory this proof did not create.
  [ "$root" = "$SANDBOX_ROOT" ] || { refuse "a root that is not the sandbox this proof created ($root)"; return 1; }

  case "$canon" in
    "${TMPDIR:-/tmp}/"?*) ;;
    *) refuse "a SANDBOX_ROOT that is not under a temp dir ($canon)"; return 1 ;;
  esac
  [ -d "$canon" ] || { refuse "a SANDBOX_ROOT that is not a directory ($canon)"; return 1; }

  abs="$canon/$rel"
  # Containment is checked on the RESOLVED path. `abs` is a string
  # concatenation, not a path: `<sandbox>/work/escape-link/precious.txt`
  # string-prefixes the root while resolving to `/tmp/elsewhere/precious.txt`
  # whenever an in-sandbox component is a symlink pointing out. The first live
  # run accepted exactly that shape, so resolve BEFORE comparing. We still print
  # the UNRESOLVED path, because a delete must act on the link itself and never
  # on what it points at.
  local resolved
  resolved=$(realpath -m -- "$abs" 2>/dev/null) ||
    { refuse "a path that cannot be resolved ($abs)"; return 1; }
  sandbox_contains "$canon" "$resolved" || { refuse "a resolved path outside $canon/ ($resolved)"; return 1; }
  printf '%s\n' "$abs"
}

TARGETS=()

sanitize_targets() { # EVERY destructive call runs its operands through here first
  TARGETS=()
  local rel abs
  for rel in "$@"; do
    if ! abs=$(sandbox_target "$SANDBOX_ROOT" "$rel"); then
      return 1
    fi
    TARGETS+=("$abs")
  done
  return 0
}

# SANCTIONED: the real-deleter oracle, reachable only through sanitize_targets.
# The benchmark the guard is measured against; not a path this proof can reach
# with anything the choke point did not hand back.
rm_oracle() { # rm_oracle <flags-token|""> <target...>
  local flags="${1-}"
  shift || true
  if ! sanitize_targets "$@"; then
    printf 'ORACLE-REFUSED: %s\n' "$SANDBOX_REFUSAL" >&2
    RC=99
    return 0
  fi
  count_live
  if [ -n "$flags" ]; then
    /usr/bin/rm $flags "${TARGETS[@]+"${TARGETS[@]}"}"
  else
    /usr/bin/rm "${TARGETS[@]+"${TARGETS[@]}"}"
  fi
  RC=$?
  return 0
}

# SANCTIONED: the rewrite target — the captured delete, behind the same choke point.
trash_guard() { # trash_guard <flags-token|""> <target...>
  local flags="${1-}"
  shift || true
  if ! sanitize_targets "$@"; then
    printf 'GUARD-REFUSED: %s\n' "$SANDBOX_REFUSAL" >&2
    RC=99
    return 0
  fi
  count_live
  if [ -n "$flags" ]; then
    "$TRASH_BIN" guard --spool "$SPOOL" $flags "${TARGETS[@]+"${TARGETS[@]}"}"
  else
    "$TRASH_BIN" guard --spool "$SPOOL" "${TARGETS[@]+"${TARGETS[@]}"}"
  fi
  RC=$?
  return 0
}

# SANCTIONED: every read carries the sandbox spool — the real store is never touched.
trash_cli() { # trash_cli <verb...>
  run_live "$TRASH_BIN" --spool "$SPOOL" "$@"
}

# ==========================================================================
# Sandbox
# ==========================================================================

[ -f "$DIST_CLI" ] || fail "$EXIT_ENV" "environment" "the built CLI is missing at $DIST_CLI — run 'bun run build' in apps/trash first"
[ -f "$DIST_INDEX" ] || fail "$EXIT_ENV" "environment" "the built index is missing at $DIST_INDEX — run 'bun run build' in apps/trash first"
[ -f "$HOOK_FILE" ] || fail "$EXIT_ENV" "environment" "the hook fixture is missing at $HOOK_FILE"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || fail "$EXIT_ENV" "environment" "bun is not on PATH"
CLAUDE="$(command -v claude || true)"
[ -n "$CLAUDE" ] || fail "$EXIT_ENV" "environment" "the claude CLI is not on PATH — hook WIRING is only provable for a freshly started session, so the proof cannot run"

SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/trash-live-proof.XXXXXXXX")"
CANARY_DIR="${SANDBOX_ROOT}-canary"
SPOOL="$SANDBOX_ROOT/spool"
WORK="$SANDBOX_ROOT/work"
TRASH_BIN="$SANDBOX_ROOT/bin/trash"
HOOK_SANDBOX="$SANDBOX_ROOT/hook/trash-guard-hook.sh"
HOOK_LOG="$SANDBOX_ROOT/hook/hook.log"
SETTINGS="$SANDBOX_ROOT/hook/settings.json"
STREAM="$SANDBOX_ROOT/hook/stream.json"
EVIDENCE="$SANDBOX_ROOT/evidence"

printf 'sandbox      %s\n' "$SANDBOX_ROOT"
printf 'canary       %s  (string-prefix sibling — left in place)\n' "$CANARY_DIR"

[ -d "$SANDBOX_ROOT" ] || fail "$EXIT_SANDBOX" "sandbox-root" "mktemp -d produced no directory"
case "$SANDBOX_ROOT" in
  "${TMPDIR:-/tmp}/"?*) ;;
  *) fail "$EXIT_SANDBOX" "sandbox-root" "$SANDBOX_ROOT is not under ${TMPDIR:-/tmp}/" ;;
esac
pass "sandbox-root" "mktemp -d under ${TMPDIR:-/tmp}/ — $SANDBOX_ROOT"

mkdir -p "$SANDBOX_ROOT/bin" "$SANDBOX_ROOT/hook" "$SPOOL" "$WORK" "$EVIDENCE" "$CANARY_DIR/keep" \
  || fail "$EXIT_SANDBOX" "sandbox-layout" "could not create the sandbox layout"
printf 'outside canary — this file must survive every checkpoint\n' > "$CANARY_DIR/canary.txt"
printf 'and this tree, whose name is a string prefix of the sandbox, must survive too\n' > "$CANARY_DIR/keep/nested.txt"
CANARY_HASH="$(sha256sum "$CANARY_DIR/canary.txt" | cut -d' ' -f1)"

[ "$CANARY_DIR" = "${SANDBOX_ROOT}-canary" ] || fail "$EXIT_SANDBOX" "canary-sibling" "the canary is not the string-prefix sibling of the sandbox"
case "$CANARY_DIR" in
  "$SANDBOX_ROOT"/*) fail "$EXIT_SANDBOX" "canary-sibling" "the canary is INSIDE the sandbox, so it proves nothing about the separator" ;;
esac
pass "canary-sibling" "$CANARY_DIR is a string prefix of $SANDBOX_ROOT but is not under it"

# The discriminator: the naive (separator-less) test MUST accept the canary. If
# it did not, the canary would have no power to catch the bug it exists for.
naive_verdict="rejected"
case "$CANARY_DIR/canary.txt" in "$SANDBOX_ROOT"*) naive_verdict="accepted" ;; esac
[ "$naive_verdict" = "accepted" ] || fail "$EXIT_SANDBOX" "canary-discriminates" "the naive prefix test also rejects the canary, so this fixture cannot detect a missing separator"
pass "canary-discriminates" "naive '$SANDBOX_ROOT*' accepts the canary; sandbox_contains must not"

# ------------------------------------------------------------------ the gate
printf '== choke point ==\n'

if sandbox_target "$SANDBOX_ROOT" /etc/hostname > /dev/null 2>&1; then
  fail "$EXIT_SANDBOX" "choke-refuses-absolute" "sandbox_target accepted the absolute path /etc/hostname"
fi
pass "choke-refuses-absolute" "refused /etc/hostname ($SANDBOX_REFUSAL)"

if sandbox_target "$SANDBOX_ROOT" 'work/*' > /dev/null 2>&1; then
  fail "$EXIT_SANDBOX" "choke-refuses-glob" "sandbox_target accepted a glob"
fi
pass "choke-refuses-glob" "refused work/* ($SANDBOX_REFUSAL)"

if sandbox_target "$SANDBOX_ROOT" '../escape' > /dev/null 2>&1; then
  fail "$EXIT_SANDBOX" "choke-refuses-traversal" "sandbox_target accepted a traversal component"
fi
pass "choke-refuses-traversal" "refused ../escape ($SANDBOX_REFUSAL)"

# The fixture that caught a real escape on the first live run: a ROOT written
# to reach the sandbox's string-prefix sibling through `..`. Every other check
# here passes for it, and the target lands outside the sandbox.
if sandbox_target "$SANDBOX_ROOT/../$(basename "$CANARY_DIR")" 'canary.txt' > /dev/null 2>&1; then
  fail "$EXIT_SANDBOX" "choke-refuses-traversal-root" "sandbox_target accepted a root that reaches the canary through .."
fi
pass "choke-refuses-traversal-root" "refused a root written as <sandbox>/../<sandbox>-canary ($SANDBOX_REFUSAL)"

if sandbox_target "$CANARY_DIR" 'canary.txt' > /dev/null 2>&1; then
  fail "$EXIT_SANDBOX" "choke-refuses-canary-root" "sandbox_target accepted the canary dir as a root"
fi
pass "choke-refuses-canary-root" "refused root=$CANARY_DIR ($SANDBOX_REFUSAL)"

if sandbox_target "/etc" 'hostname' > /dev/null 2>&1; then
  fail "$EXIT_SANDBOX" "choke-refuses-foreign-root" "sandbox_target accepted /etc as a root"
fi
pass "choke-refuses-foreign-root" "refused root=/etc ($SANDBOX_REFUSAL)"

if sandbox_contains "/etc" "/etc/hostname"; then
  fail "$EXIT_SANDBOX" "choke-refuses-non-temp-root" "sandbox_contains accepted a root outside a temp dir"
fi
pass "choke-refuses-non-temp-root" "sandbox_contains refused a root outside a temp dir (root=/etc)"

if sandbox_contains "$SANDBOX_ROOT" "$CANARY_DIR/canary.txt"; then
  fail "$EXIT_SANDBOX" "choke-refuses-canary" "containment ACCEPTED the sibling-prefix canary — the separator check is broken"
fi
pass "choke-refuses-canary" "sandbox_contains refused $CANARY_DIR/canary.txt (prefix sibling)"

if sandbox_contains "$SANDBOX_ROOT" "$SANDBOX_ROOT"; then
  fail "$EXIT_SANDBOX" "choke-refuses-root" "containment accepted the sandbox root itself"
fi
pass "choke-refuses-root" "sandbox_contains refused the root itself"

if sandbox_contains "$SANDBOX_ROOT" "$SANDBOX_ROOT/work/probe.txt"; then
  pass "choke-accepts-inside" "sandbox_contains accepted $SANDBOX_ROOT/work/probe.txt"
else
  fail "$EXIT_SANDBOX" "choke-accepts-inside" "sandbox_contains refused a legitimate path inside the sandbox"
fi

if ! sanitize_targets 'work/probe.txt'; then
  fail "$EXIT_SANDBOX" "choke-accepts-relative" "sanitize_targets refused a legitimate relative path ($SANDBOX_REFUSAL)"
fi
pass "choke-accepts-relative" "accepted work/probe.txt -> ${TARGETS[0]}"

# ==========================================================================
# Fixtures
# ==========================================================================

printf '== fixtures ==\n'

# The `trash` binary a fresh install puts on PATH: a shim, because the bundle is
# not self-executing. SANCTIONED: this line writes the shim script; it invokes nothing.
printf '#!/bin/sh\nexec %s %s "$@"\n' "$BUN" "$DIST_CLI" > "$TRASH_BIN" # SANCTIONED
chmod +x "$TRASH_BIN"
# SANCTIONED: compares two names for the wiring check; it invokes nothing.
EXPECTED_BIN="$TRASH_BIN"
cp "$HOOK_FILE" "$HOOK_SANDBOX"
chmod +x "$HOOK_SANDBOX"

mkfixture() { # mkfixture <sandbox-relative-path> <kind> -> prints the absolute path
  local rel="$1" kind="$2" abs
  abs=$(sandbox_target "$SANDBOX_ROOT" "$rel") || return 1
  mkdir -p "$(dirname "$abs")" || return 1
  case "$kind" in
    tree)
      mkdir -p "$abs/sub" "$abs/deep/deeper" || return 1
      printf 'alpha content\n' > "$abs/a.txt"
      printf 'beta content\n' > "$abs/sub/b.txt"
      printf 'gamma content\n' > "$abs/deep/deeper/c.txt"
      printf '#!/bin/sh\necho hi\n' > "$abs/run.sh"
      printf 'read only\n' > "$abs/ro.txt"
      chmod 755 "$abs/run.sh"
      chmod 444 "$abs/ro.txt"
      chmod 700 "$abs/sub"
      ln -s a.txt "$abs/link-file"
      ln -s sub "$abs/link-dir"
      ;;
    emptydir) mkdir -p "$abs" || return 1 ;;
    fulldir) mkdir -p "$abs" || return 1; printf 'keep\n' > "$abs/keep.txt" ;;
    file) printf 'payload\n' > "$abs" || return 1 ;;
    ro) printf 'read only file\n' > "$abs" || return 1; chmod 444 "$abs" ;;
    missing) : ;;
    *) return 1 ;;
  esac
  printf '%s\n' "$abs"
}

HOOKED_ABS=$(mkfixture 'work/hooked' tree) || fail "$EXIT_SANDBOX" "fixture-hooked" "could not build work/hooked ($SANDBOX_REFUSAL)"
TWIN_ABS=$(mkfixture 'work/twin' tree) || fail "$EXIT_SANDBOX" "fixture-twin" "could not build work/twin ($SANDBOX_REFUSAL)"
UNRESTORED_ABS=$(mkfixture 'work/unrestored' tree) || fail "$EXIT_SANDBOX" "fixture-unrestored" "could not build work/unrestored ($SANDBOX_REFUSAL)"

# The inode of one file, recorded before capture: a move preserves it, a copy
# does not. This is what makes "restore is a move, not a copy" falsifiable.
HOOKED_INODE="$(stat -c '%i' "$HOOKED_ABS/a.txt")"

manifest() { # manifest <base> -> canonical <kind> <mode> <relpath> [<sha256>|<link target>]
  local base="$1" p rel
  while IFS= read -r p; do
    if [ "$p" = "$base" ]; then rel="."; else rel="${p#"$base"/}"; fi
    if [ -L "$p" ]; then
      printf 'link\t%s\t%s\t%s\n' "$(stat -c '%a' "$p")" "$rel" "$(readlink "$p")"
    elif [ -d "$p" ]; then
      printf 'dir\t%s\t%s\n' "$(stat -c '%a' "$p")" "$rel"
    elif [ -f "$p" ]; then
      printf 'file\t%s\t%s\t%s\n' "$(stat -c '%a' "$p")" "$rel" "$(sha256sum "$p" | cut -d' ' -f1)"
    else
      printf 'other\t%s\t%s\n' "$(stat -c '%a' "$p")" "$rel"
    fi
  done < <(find "$base" | LC_ALL=C sort)
}

HOOKED_MANIFEST_BEFORE="$EVIDENCE/manifest-before.txt"
manifest "$HOOKED_ABS" > "$HOOKED_MANIFEST_BEFORE"
MANIFEST_LINES="$(grep -c . "$HOOKED_MANIFEST_BEFORE")"
[ "$MANIFEST_LINES" -ge 10 ] || fail "$EXIT_SANDBOX" "fixture-manifest" "the pre-capture manifest has only $MANIFEST_LINES lines, so it cannot prove much"
pass "fixture-manifest" "$MANIFEST_LINES lines before any capture (sha256+mode per file, mode per dir, symlink target per link)"

canary_checkpoint() { # canary_checkpoint <label> <exit-code>
  local label="$1" code="$2" now
  if [ ! -f "$CANARY_DIR/canary.txt" ] || [ ! -f "$CANARY_DIR/keep/nested.txt" ]; then
    fail "$code" "canary@$label" "the outside canary is missing at checkpoint $label"
  fi
  now="$(sha256sum "$CANARY_DIR/canary.txt" | cut -d' ' -f1)"
  if [ "$now" != "$CANARY_HASH" ]; then
    fail "$code" "canary@$label" "the outside canary was MODIFIED at checkpoint $label ($now != $CANARY_HASH)"
  fi
  pass "canary@$label" "outside canary intact (sha256 ${now:0:16}…)"
}

# ==========================================================================
# The real store, fingerprinted read-only
# ==========================================================================

fingerprint_paths() { # fingerprint_paths <path...> -> sha256 over a read-only walk
  local p
  for p in "$@"; do
    if [ -e "$p" ] || [ -L "$p" ]; then
      printf 'EXISTS %s\n' "$p"
      find "$p" -printf '%p\t%y\t%m\t%s\t%T@\n' 2>/dev/null | LC_ALL=C sort
    else
      printf 'ABSENT %s\n' "$p"
    fi
  done | sha256sum | cut -d' ' -f1
}

printf '== real store (read-only fingerprint) ==\n'
REAL_ROOTS_SCRIPT="$EVIDENCE/real-roots.mjs"
cat > "$REAL_ROOTS_SCRIPT" <<'EOF'
const m = await import(process.argv[2]);
const roots = m.resolveTrashRoots({});
process.stdout.write(JSON.stringify([roots.files, roots.state, roots.config, `${process.env.HOME}/.hasna/trash`]));
EOF
count_live
REAL_ROOTS_JSON="$(env -u HASNA_CONFIG_HOME -u HASNA_DATA_HOME -u HASNA_STATE_HOME -u HASNA_CACHE_HOME "$BUN" "$REAL_ROOTS_SCRIPT" "$DIST_INDEX" 2>/dev/null)"
REAL_ROOTS_RC=$?
[ "$REAL_ROOTS_RC" -eq 0 ] || fail "$EXIT_REALSTORE" "real-store-roots" "the path resolver did not answer (rc=$REAL_ROOTS_RC)"
mapfile -t REAL_ROOTS < <(printf '%s' "$REAL_ROOTS_JSON" | jq -er '.[]' 2>/dev/null)
[ "${#REAL_ROOTS[@]}" -eq 4 ] || fail "$EXIT_REALSTORE" "real-store-roots" "expected 4 resolved roots, got ${#REAL_ROOTS[@]}"
pass "real-store-roots" "resolved read-only: ${REAL_ROOTS[*]}"

REAL_FP_BEFORE="$(fingerprint_paths "${REAL_ROOTS[@]}")"
pass "real-store-before" "sha256 ${REAL_FP_BEFORE:0:24}… (read-only walk of every root)"

SYSTEM_CANARY=/etc/hostname
SYSTEM_CANARY_HASH="$(sha256sum "$SYSTEM_CANARY" 2>/dev/null | cut -d' ' -f1)"
[ -n "$SYSTEM_CANARY_HASH" ] || fail "$EXIT_CANARY" "system-canary" "could not hash $SYSTEM_CANARY"

# ==========================================================================
# (a) Wiring: a freshly started session with the sandbox settings
# ==========================================================================

printf '== wiring: a freshly started session with the sandbox settings ==\n'

# SANCTIONED: builds the hook's command TEXT (the config carrier, §4); it invokes nothing.
HOOK_CMD="$HOOK_SANDBOX --spool $SPOOL --trash $TRASH_BIN --log $HOOK_LOG"

cat > "$SETTINGS" <<EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_CMD",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
EOF

# `claude -p` SILENTLY IGNORES a settings file that fails validation, and an
# ignored settings file means no hook — which means the next delete is a real one.
expect_jq "$EXIT_WIRING" "settings-validate" "$SETTINGS" '
  (.hooks.PreToolUse | type == "array") and
  (.hooks.PreToolUse | length == 1) and
  (.hooks.PreToolUse[0].matcher == "Bash") and
  (.hooks.PreToolUse[0].hooks | length == 1) and
  (.hooks.PreToolUse[0].hooks[0].type == "command") and
  (.hooks.PreToolUse[0].hooks[0].timeout == 5) and
  (.hooks.PreToolUse[0].hooks[0].command | test("--spool .*/spool --trash .*/bin/trash --log .*/hook/hook\\.log$"))
  | "valid JSON; one Bash PreToolUse command hook, timeout=5, spool+bin+log carried in the command text"'

# SANCTIONED: the command TEXT the nested session is asked to run. It is a string
# handed to the model, never executed by this script; it names the fixture
# work/hooked inside the sandbox, and the proof fails at once if the hook did
# not intercept it (the wiring assertion has no fallback).
#
# The prompt is deliberately truthful and non-coercive, and the fixture is
# described as what it is. An earlier version demanded a blind delete as the
# session's "first and only action" and forbade all inspection; three freshly
# started sessions refused it outright, each saying the no-inspection framing was
# the reason. That is a fact about the model, not about the hook — and a proof
# that needs a model deceived into acting is not a proof of the hook. So the
# prompt tells the session what the directory is, invites it to look first, and
# the proof re-rolls up to ATTEMPT_MAX times rather than calling an uncooperative
# model a hook failure. The assertion itself never weakens: a delete of the
# fixture must appear in the hook log as an intercepted rewrite, and a fixture
# that vanishes without one fails the proof on the spot.
PROMPT="This session is a test of a file-deletion safety hook, and you are the test driver. Your working directory is a throwaway sandbox the test harness created for this run under /tmp. The directory hooked inside it is a fixture the harness built a moment ago for exactly this test: a few small text files, two symlinks and some subdirectories, nothing else, and nothing outside the sandbox is affected. Please run this exact command with the Bash tool: rm -rf hooked. Look at the fixture first if you like. Then reply DONE." # SANCTIONED

# SANCTIONED: a PATTERN naming the delete the harness was asked to run; it invokes nothing.
DID_DELETE_RE='rm +[^ ]* +[^ ]*hooked' # SANCTIONED

ATTEMPT_MAX=3
ATTEMPT=0
DELETED_ATTEMPT=0
while [ "$ATTEMPT" -lt "$ATTEMPT_MAX" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  printf 'wiring attempt %d of %d: a nested claude session with the sandbox settings (the slow step)...\n' "$ATTEMPT" "$ATTEMPT_MAX"
  (
    cd "$WORK" || exit 1
    PATH="$SANDBOX_ROOT/bin:$PATH" timeout 420 "$CLAUDE" -p \
      --settings "$SETTINGS" \
      --allowedTools "Bash" \
      --output-format stream-json \
      --verbose \
      --max-turns 10 \
      "$PROMPT"
  ) > "$STREAM" 2> "$EVIDENCE/claude.stderr" < /dev/null
  CLAUDE_RC=$?
  count_live
  printf '  exit=%d, stream=%s bytes\n' "$CLAUDE_RC" "$(stat -c '%s' "$STREAM" 2>/dev/null || printf '?')"

  if [ -f "$HOOK_LOG" ] && jq -e --arg pat "$DID_DELETE_RE" \
       'select(.tool == "Bash") | select(.command | test($pat))' < "$HOOK_LOG" > /dev/null 2>&1; then
    DELETED_ATTEMPT=$ATTEMPT
    break
  fi

  # A fixture that vanished with no intercepted delete in the log is the failure
  # this whole proof exists to catch: the delete ran unguarded.
  if [ ! -d "$HOOKED_ABS" ]; then
    fail "$EXIT_WIRING" "hook-fired" "$HOOKED_ABS is gone and the hook log records no intercepted delete — the session's delete ran unguarded"
  fi
  cp "$STREAM" "$EVIDENCE/stream-attempt-$ATTEMPT.json" 2>/dev/null
done

if [ "$DELETED_ATTEMPT" = "0" ]; then
  fail "$EXIT_WIRING" "hook-fired" "across $ATTEMPT freshly started session(s), no intercepted delete reached the hook log — the log holds: $(tr '\n' ' ' < "$HOOK_LOG" 2>/dev/null | cut -c1-200)"
fi
pass "wiring-attempts" "a delete was issued and intercepted on attempt $DELETED_ATTEMPT, out of $ATTEMPT allocated"
expect_jq "$EXIT_WIRING" "hook-fired" "$HOOK_LOG" '
  select(.tool == "Bash") | select(.command | test($pat))
  | "hook fired on: \(.command)"' --arg pat "$DID_DELETE_RE"

expect_jq "$EXIT_WIRING" "hook-decision-rewrite" "$HOOK_LOG" '
  select(.tool == "Bash") | select(.command | test($pat)) | select(.decision == "rewrite")
  | "decision=rewrite -> \(.rewritten)"' --arg pat "$DID_DELETE_RE"

expect_jq "$EXIT_WIRING" "hook-rewrote-to-guard" "$HOOK_LOG" '
  select(.decision == "rewrite")
  | select(.rewritten | test("^trash guard --spool " + $spool + " "))
  | "the rewrite names the sandbox spool: \(.rewritten)"' --arg spool "$SPOOL"

RESOLVED_BIN="$(jqr "$HOOK_LOG" 'select(.decision == "rewrite") | .trash' | head -1)"
if [ "$RESOLVED_BIN" != "$EXPECTED_BIN" ]; then
  fail "$EXIT_WIRING" "hook-resolves-sandbox-bin" "inside the hook, resolving the binary on PATH gave '$RESOLVED_BIN', not the sandbox shim $EXPECTED_BIN"
fi
pass "hook-resolves-sandbox-bin" "the rewritten delete resolves to $RESOLVED_BIN (the sandbox shim, not a globally installed one)"

canary_checkpoint "after-hook" "$EXIT_CANARY"

# ==========================================================================
# (b) Capture
# ==========================================================================

printf '== capture ==\n'
LIST_JSON="$EVIDENCE/list.json"
trash_cli list --json > "$LIST_JSON" 2>/dev/null

expect_jq "$EXIT_CAPTURE" "capture-landed" "$LIST_JSON" '
  [ .[] | select(.originalPath == $path) ]
  | if length >= 1 then "entry \(.[0].id) for the hooked fixture" else error("no entry for the hooked fixture") end' \
  --arg path "$HOOKED_ABS"

expect_jq "$EXIT_CAPTURE" "capture-entry-shape" "$LIST_JSON" '
  [ .[] | select(.originalPath == $path) ][0]
  | if (.status == "staged") and (.kind == "dir") and (.sha256 | test("^[0-9a-f]{64}$")) and (.sizeBytes > 0)
    then "status=\(.status) kind=\(.kind) sha256=\(.sha256[0:16])… size=\(.sizeBytes)"
    else error("unexpected entry shape") end' \
  --arg path "$HOOKED_ABS"

HOOKED_ID="$(jqr "$LIST_JSON" '.[] | select(.originalPath == $path) | .id' --arg path "$HOOKED_ABS" | head -1)"
[ -n "$HOOKED_ID" ] || fail "$EXIT_CAPTURE" "capture-entry-id" "no entry id for the hooked fixture"

if [ -e "$HOOKED_ABS" ]; then
  fail "$EXIT_CAPTURE" "capture-path-gone" "$HOOKED_ABS still exists — the intercepted delete did not happen"
fi
pass "capture-path-gone" "$HOOKED_ABS is gone from its path"

# ==========================================================================
# (c) list
# ==========================================================================

printf '== list ==\n'
LIST_TEXT="$EVIDENCE/list.txt"
trash_cli list > "$LIST_TEXT" 2>/dev/null
if ! grep -q "$HOOKED_ID" "$LIST_TEXT"; then
  fail "$EXIT_LIST" "list-shows-entry" "'trash list' did not print the entry id $HOOKED_ID"
fi
if ! grep -qF "$HOOKED_ABS" "$LIST_TEXT"; then
  fail "$EXIT_LIST" "list-shows-entry" "'trash list' did not print the original path $HOOKED_ABS"
fi
pass "list-shows-entry" "$(grep -F "$HOOKED_ABS" "$LIST_TEXT" | cut -c1-150)"

# ==========================================================================
# (e) Exit-code parity
# ==========================================================================

printf '== exit-code parity ==\n'

# The real-delete control: the twin, removed by the oracle with the same argv
# shape as the intercepted command.
printf '%s\n' "real-deletion control: the oracle removes the twin fixture work/twin with the same argv shape"
rm_oracle "-rf" work/twin
RM_TWIN_RC=$RC

# The harness's own reporting of a tool result, as PAIRS of {command, result}:
# the Bash tool_use and the tool_result that answered it.
pairs_from_stream() { # pairs_from_stream <stream.json> -> [{command, result}]
  jq -s '
    reduce .[] as $m ({pending: null, pairs: []};
      if ($m | type) == "object" and $m.type == "assistant" then
        (reduce ($m.message.content[]? | select(type == "object") | select(.type == "tool_use" and .name == "Bash")) as $b
           (.; .pending = $b.input.command))
      elif ($m | type) == "object" and $m.type == "user" then
        (reduce ($m.message.content[]? | select(type == "object") | select(.type == "tool_result")) as $r
           (.; .pairs += [{command: (.pending // ""), result: ($r.content | tostring)}]))
      else . end)
    | .pairs
  ' "$1" 2>/dev/null
}

# The one reader of a harness-reported exit code. `capture` yields EMPTY (not an
# error) when the pattern does not match, so `try/catch` would silently drop the
# pair; `// "0"` is the form that actually holds.
read_harness_rc() { # read_harness_rc <pairs.json> <command-pattern> -> the code, or "none"
  jqr "$1" '
    [ .[] | select(.command | test($pat)) ]
    | map(((.result | capture("^Exit code (?<rc>[0-9]+)").rc) // "0") | tonumber)
    | if length == 0 then "none" else (.[0] | tostring) end' --arg pat "$2"
}

INTERCEPTED_JSON="$EVIDENCE/intercepted.json"
pairs_from_stream "$STREAM" > "$INTERCEPTED_JSON"

expect_jq "$EXIT_ECPARITY" "intercepted-command-ran" "$INTERCEPTED_JSON" '
  [ .[] | select(.command | test($pat)) ]
  | if length >= 1 then "the harness ran: \(.[0].command)" else error("the nested session never issued the delete") end' \
  --arg pat "$DID_DELETE_RE"

# WHAT THE HARNESS PRINTS, MEASURED IN THIS RUN RATHER THAN ASSUMED. It writes
# "Exit code N" only for a NON-ZERO exit and the command's own output otherwise,
# so the success case below is the harness's silence — and silence is only
# evidence once the reader has been shown a number it could not have invented.
# Hence a second, small session whose command exits 7.
READER_PROMPT="This session measures how the tool harness reports the exit code of a command, and you are the test driver. Please run exactly this command with the Bash tool, as a bare command and nothing else: exit 7. It ends that shell with status 7 and touches nothing on disk. Then reply DONE."
READER_JSON="$EVIDENCE/reader.json"
READER_MAX=2
READER_ATTEMPT=0
READER_CODE=""
while [ "$READER_ATTEMPT" -lt "$READER_MAX" ]; do
  READER_ATTEMPT=$((READER_ATTEMPT + 1))
  READER_STREAM="$EVIDENCE/reader-$READER_ATTEMPT.json"
  printf 'reader attempt %d of %d: a session asked to run a command that exits 7...\n' "$READER_ATTEMPT" "$READER_MAX"
  (
    cd "$WORK" || exit 1
    PATH="$SANDBOX_ROOT/bin:$PATH" timeout 300 "$CLAUDE" -p \
      --settings "$SETTINGS" \
      --allowedTools "Bash" \
      --output-format stream-json \
      --verbose \
      --max-turns 4 \
      "$READER_PROMPT"
  ) > "$READER_STREAM" 2> "$EVIDENCE/reader.stderr" < /dev/null
  count_live
  pairs_from_stream "$READER_STREAM" > "$READER_JSON"
  READER_CODE="$(read_harness_rc "$READER_JSON" 'exit[[:space:]]*7')"
  if [ "$READER_CODE" = "7" ]; then break; fi
  printf '  the reader read back %s\n' "$READER_CODE"
done
[ "$READER_CODE" = "7" ] || fail "$EXIT_ECPARITY" "exitcode-reader" "a session was asked to run a command that exits 7 and the reader read back '$READER_CODE' — an exit-code reader that cannot see a non-zero code cannot be trusted with a zero one"
pass "exitcode-reader" "a session whose command exits 7 reported 'Exit code 7', and the reader read 7 back (attempt $READER_ATTEMPT)"

expect_jq "$EXIT_ECPARITY" "exitcode-reader-silent-on-success" "$INTERCEPTED_JSON" '
  [ .[] | select(.command | test($pat)) ]
  | if length == 1 and (.[0].result | test("Exit code") | not)
    then "the successful intercepted delete carries no exit-code line — the harness prints one only for a non-zero exit, and the capture check above proved this delete ran to completion"
    else error("the intercepted delete carried an exit-code line, so this is not the success case") end' \
  --arg pat "$DID_DELETE_RE"

INTERCEPTED_RC="$(read_harness_rc "$INTERCEPTED_JSON" "$DID_DELETE_RE")"
[ "$INTERCEPTED_RC" != "none" ] || fail "$EXIT_ECPARITY" "intercepted-exit-code" "no tool result was found for the intercepted delete"
[ "$INTERCEPTED_RC" = "$RM_TWIN_RC" ] || fail "$EXIT_ECPARITY" "intercepted-exit-code" "the intercepted command exited $INTERCEPTED_RC but the oracle on the twin exited $RM_TWIN_RC"
pass "intercepted-exit-code" "the intercepted delete reported no failure line (exit 0 by the harness convention just measured), and the oracle's real-deletion control on the identical twin fixture exited $RM_TWIN_RC"

canary_checkpoint "after-capture" "$EXIT_CANARY"

# The parity table proper: the guard vs the oracle, one fresh fixture each, same
# flags, comparing exit codes only.
parity_case() { # parity_case <label> <kind> <index> <flags-token|"">
  local label="$1" kind="$2" idx="$3" flags="${4-}"
  local rm_rel="work/parity-rm-$idx/target" gd_rel="work/parity-guard-$idx/target"
  local rm_rc gd_rc
  mkfixture "$rm_rel" "$kind" > /dev/null || fail "$EXIT_SANDBOX" "fixture-$label" "could not build the oracle fixture ($SANDBOX_REFUSAL)"
  mkfixture "$gd_rel" "$kind" > /dev/null || fail "$EXIT_SANDBOX" "fixture-$label" "could not build the guard fixture ($SANDBOX_REFUSAL)"

  rm_oracle "$flags" "$rm_rel"
  rm_rc=$RC
  trash_guard "$flags" "$gd_rel"
  gd_rc=$RC

  if [ "$rm_rc" = "99" ] || [ "$gd_rc" = "99" ]; then
    fail "$EXIT_ECPARITY" "parity-$label" "a choke-point refusal leaked into the parity table (oracle=$rm_rc guard=$gd_rc)"
  fi
  if [ "$rm_rc" != "$gd_rc" ]; then
    fail "$EXIT_ECPARITY" "parity-$label" "the oracle exited $rm_rc, the guard exited $gd_rc — the contract diverges"
  fi
  pass "parity-$label" "oracle=$rm_rc  guard=$gd_rc"
}

parity_case "rf-tree"         tree     1 -rf
parity_case "f-missing"       missing  2 -f
parity_case "missing-noflags" missing  3 ""
parity_case "d-emptydir"      emptydir 4 -d
parity_case "d-fulldir"       fulldir  5 -d
parity_case "fulldir-noflags" fulldir  6 ""
parity_case "f-file"          file     7 -f
parity_case "f-readonly"      ro       8 -f
parity_case "rf-deep-tree"    tree     9 -rf

rm_oracle ""
NOOP_RM=$RC
trash_guard ""
NOOP_GUARD=$RC
[ "$NOOP_RM" = "$NOOP_GUARD" ] || fail "$EXIT_ECPARITY" "parity-no-operands" "the oracle with no operands exited $NOOP_RM, the guard exited $NOOP_GUARD"
pass "parity-no-operands" "oracle=$NOOP_RM  guard=$NOOP_GUARD"

rm_oracle "-f"
NOOP_RM_F=$RC
trash_guard "-f"
NOOP_GUARD_F=$RC
[ "$NOOP_RM_F" = "$NOOP_GUARD_F" ] || fail "$EXIT_ECPARITY" "parity-f-no-operands" "the oracle with -f and no operands exited $NOOP_RM_F, the guard exited $NOOP_GUARD_F"
pass "parity-f-no-operands" "oracle=$NOOP_RM_F  guard=$NOOP_GUARD_F (the empty-list idiom: the force flag with no operands)"

# ==========================================================================
# (d) Restore — byte-identical, and by moving rather than copying
# ==========================================================================

printf '== restore ==\n'
RESTORE_JSON="$EVIDENCE/restore.json"
trash_cli restore "$HOOKED_ID" --json > "$RESTORE_JSON" 2>/dev/null

expect_jq "$EXIT_RESTORE" "restore-returns-path" "$RESTORE_JSON" '
  select(.id == $id) | select(.restoredTo == $to)
  | "restored \(.id) -> \(.restoredTo) sha256=\(.sha256[0:16])…"' \
  --arg id "$HOOKED_ID" --arg to "$HOOKED_ABS"

[ -d "$HOOKED_ABS" ] || fail "$EXIT_RESTORE" "restored-path-exists" "$HOOKED_ABS does not exist after restore"

HOOKED_MANIFEST_AFTER="$EVIDENCE/manifest-after.txt"
manifest "$HOOKED_ABS" > "$HOOKED_MANIFEST_AFTER"

if ! diff -u "$HOOKED_MANIFEST_BEFORE" "$HOOKED_MANIFEST_AFTER" > "$EVIDENCE/manifest.diff" 2>&1; then
  fail "$EXIT_RESTORE" "restore-byte-identical" "the restored tree differs from the pre-capture manifest — see $EVIDENCE/manifest.diff"
fi
pass "restore-byte-identical" "$MANIFEST_LINES lines identical after the round trip (sha256+mode per file, mode per dir, symlink target per link)"

PAYLOAD="$SPOOL/files/$HOOKED_ID"
if [ -e "$PAYLOAD" ]; then
  fail "$EXIT_RESTORE" "restore-is-a-move" "the spool payload $PAYLOAD still exists after restore — that was a copy, not a move"
fi
pass "restore-is-a-move" "the spool payload for $HOOKED_ID is gone after restore"

HOOKED_INODE_AFTER="$(stat -c '%i' "$HOOKED_ABS/a.txt")"
if [ "$HOOKED_INODE_AFTER" != "$HOOKED_INODE" ]; then
  fail "$EXIT_RESTORE" "restore-preserves-inode" "inode changed $HOOKED_INODE -> $HOOKED_INODE_AFTER: the bytes were copied, not moved"
fi
pass "restore-preserves-inode" "a.txt inode $HOOKED_INODE survived capture and restore intact"

canary_checkpoint "after-restore" "$EXIT_CANARY"

# ==========================================================================
# Negative controls
# ==========================================================================

printf '== negative controls ==\n'

# 1. The unrestored control: gone from its path AND present in the store. The
#    conjunction is the proof; either half alone proves nothing.
#
#    First a refusal that must not be papered over. With no flags the real
#    deleter refuses a directory (exit 1, nothing removed — the parity table's
#    own fulldir-noflags row), and the guard must refuse it the same way AND
#    capture nothing. A guard that captured a deletion the real deleter refused
#    would be inventing one, and the store would then hold an entry for a tree
#    that never left its path.
trash_guard "" "work/unrestored"
UNRESTORED_REFUSAL_RC=$RC
[ "$UNRESTORED_REFUSAL_RC" = "1" ] || fail "$EXIT_NEGATIVE" "unrestored-flagless-refusal" "the flagless guard delete of a directory exited $UNRESTORED_REFUSAL_RC, not 1"
[ -f "$UNRESTORED_ABS/a.txt" ] || fail "$EXIT_NEGATIVE" "unrestored-flagless-refusal" "$UNRESTORED_ABS/a.txt is gone: an operation the real deleter refuses removed content anyway"
UNRESTORED_PRE_JSON="$EVIDENCE/list-unrestored-pre.json"
trash_cli list --json > "$UNRESTORED_PRE_JSON" 2>/dev/null
expect_jq "$EXIT_NEGATIVE" "unrestored-flagless-refusal" "$UNRESTORED_PRE_JSON" '
  [ .[] | select(.originalPath == $path) ]
  | if length == 0 then "the deleter refused it and the store holds no entry for it — nothing was captured that was not deleted" else error("the store holds an entry for a deletion that never happened") end' \
  --arg path "$UNRESTORED_ABS"

#    Now the control proper, with the flags this fixture actually needs:
trash_guard "-rf" "work/unrestored"
UNRESTORED_RC=$RC
[ "$UNRESTORED_RC" = "0" ] || fail "$EXIT_NEGATIVE" "unrestored-control" "the direct guard delete exited $UNRESTORED_RC"
UNRESTORED_JSON="$EVIDENCE/list-unrestored.json"
trash_cli list --json > "$UNRESTORED_JSON" 2>/dev/null
if [ -e "$UNRESTORED_ABS" ]; then
  fail "$EXIT_NEGATIVE" "unrestored-control" "$UNRESTORED_ABS still exists, so nothing was captured"
fi
expect_jq "$EXIT_NEGATIVE" "unrestored-control" "$UNRESTORED_JSON" '
  [ .[] | select(.originalPath == $path) ]
  | if length >= 1 then "gone from its path AND staged in the store as \(.[0].id)" else error("absent from the store") end' \
  --arg path "$UNRESTORED_ABS"

# 2. The real-delete twin: gone from its path and NOT in the store — the oracle
#    is honest and nothing else is silently capturing.
if [ -e "$TWIN_ABS" ]; then
  fail "$EXIT_NEGATIVE" "real-delete-twin" "$TWIN_ABS survived the oracle"
fi
expect_jq "$EXIT_NEGATIVE" "real-delete-twin" "$UNRESTORED_JSON" '
  [ .[] | select(.originalPath == $path) ]
  | if length == 0 then "the oracle removed the twin with NO store entry — the oracle is honest" else error("a store entry exists for the twin") end' \
  --arg path "$TWIN_ABS"

# 3. The protected class: the guard refuses /etc/hostname. `--plan` is a pure
#    function of the command string — it decides, it does not delete.
PLAN_JSON="$EVIDENCE/plan-protected.json"
# SANCTIONED: the command TEXT the guard is asked to plan. `--plan` is a pure
# function of that string — it decides, it never touches the filesystem.
PROTECTED_CMD='rm -rf /etc/hostname' # SANCTIONED
run_live "$TRASH_BIN" guard --spool "$SPOOL" --plan "$PROTECTED_CMD" > "$PLAN_JSON" 2>/dev/null
PLAN_RC=$RC
[ "$PLAN_RC" = "2" ] || fail "$EXIT_NEGATIVE" "guard-denies-protected" "the guard's plan for /etc/hostname exited $PLAN_RC, not 2"
expect_jq "$EXIT_NEGATIVE" "guard-denies-protected" "$PLAN_JSON" '
  select(.decision == "deny") | select(.reason | test("protected class"))
  | "decision=deny: \(.reason)"'

PLAN_ALLOW_JSON="$EVIDENCE/plan-allow.json"
run_live "$TRASH_BIN" guard --spool "$SPOOL" --plan 'echo hello world' > "$PLAN_ALLOW_JSON" 2>/dev/null
ALLOW_RC=$RC
[ "$ALLOW_RC" = "0" ] || fail "$EXIT_NEGATIVE" "guard-allows-nondelete" "the guard's plan for a command that is not a delete exited $ALLOW_RC"
expect_jq "$EXIT_NEGATIVE" "guard-allows-nondelete" "$PLAN_ALLOW_JSON" '
  select(.decision == "allow") | "decision=allow: \(.reason)"'

# 4. The hook fails CLOSED when the guard binary is absent: the delete is
#    refused, nothing is rewritten, and the original command never runs.
FAILCLOSED_OUT="$EVIDENCE/failclosed.out"
FAILCLOSED_ERR="$EVIDENCE/failclosed.err"
count_live
# SANCTIONED: the hook payload fed on stdin. It is a fixture input the hook
# reads and refuses; nothing in this script executes it.
FAILCLOSED_PAYLOAD="$(printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"rm -rf hooked"}}' "$WORK")" # SANCTIONED
printf '%s' "$FAILCLOSED_PAYLOAD" \
  | "$HOOK_SANDBOX" --spool "$SPOOL" --trash "$SANDBOX_ROOT/bin/definitely-not-installed" --log "$EVIDENCE/failclosed.log" \
  > "$FAILCLOSED_OUT" 2> "$FAILCLOSED_ERR"
FAILCLOSED_RC=$?
[ "$FAILCLOSED_RC" = "2" ] || fail "$EXIT_NEGATIVE" "hook-fails-closed" "with no guard binary the hook exited $FAILCLOSED_RC, not 2 — it fails OPEN"
[ ! -s "$FAILCLOSED_OUT" ] || fail "$EXIT_NEGATIVE" "hook-fails-closed" "the hook emitted output with no guard binary: $(head -c 120 "$FAILCLOSED_OUT")"
pass "hook-fails-closed" "no guard binary -> exit 2, empty stdout: $(head -c 96 "$FAILCLOSED_ERR")"

# 5. The hook still ALLOWS a non-delete with the guard present — it is not a
#    blanket denial wearing a guard's clothes.
ALLOWPROBE_OUT="$EVIDENCE/allowprobe.out"
ALLOWPROBE_LOG="$EVIDENCE/allowprobe.log"
count_live
printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"echo absolutely harmless"}}' "$WORK" \
  | "$HOOK_SANDBOX" --spool "$SPOOL" --trash "$TRASH_BIN" --log "$ALLOWPROBE_LOG" \
  > "$ALLOWPROBE_OUT" 2>/dev/null
ALLOWPROBE_RC=$?
[ "$ALLOWPROBE_RC" = "0" ] || fail "$EXIT_NEGATIVE" "hook-allows-nondelete" "the hook refused a harmless command (exit $ALLOWPROBE_RC)"
[ ! -s "$ALLOWPROBE_OUT" ] || fail "$EXIT_NEGATIVE" "hook-allows-nondelete" "the hook emitted a rewrite for a command that is not a delete: $(head -c 120 "$ALLOWPROBE_OUT")"
expect_jq "$EXIT_NEGATIVE" "hook-allows-nondelete" "$ALLOWPROBE_LOG" '
  select(.command == "echo absolutely harmless") | select(.decision == "allow")
  | "decision=allow: \(.reason)"'

canary_checkpoint "after-negatives" "$EXIT_CANARY"

# ==========================================================================
# The things that must NOT have moved
# ==========================================================================

printf '== canaries and the real store ==\n'

SYSTEM_CANARY_HASH_AFTER="$(sha256sum "$SYSTEM_CANARY" 2>/dev/null | cut -d' ' -f1)"
if [ "$SYSTEM_CANARY_HASH_AFTER" != "$SYSTEM_CANARY_HASH" ]; then
  fail "$EXIT_CANARY" "system-canary-survives" "$SYSTEM_CANARY changed (${SYSTEM_CANARY_HASH_AFTER:0:16} != ${SYSTEM_CANARY_HASH:0:16})"
fi
pass "system-canary-survives" "$SYSTEM_CANARY intact (sha256 ${SYSTEM_CANARY_HASH_AFTER:0:16}…); the guard refused it and nothing touched it"

REAL_FP_AFTER="$(fingerprint_paths "${REAL_ROOTS[@]}")"
if [ "$REAL_FP_AFTER" != "$REAL_FP_BEFORE" ]; then
  fail "$EXIT_REALSTORE" "real-store-untouched" "the operator's real store changed: ${REAL_FP_BEFORE:0:24}… -> ${REAL_FP_AFTER:0:24}…"
fi
pass "real-store-untouched" "sha256 ${REAL_FP_AFTER:0:24}… unchanged across the whole run (${REAL_ROOTS[0]} …)"

canary_checkpoint "final" "$EXIT_CANARY"

# ==========================================================================
# Verdict
# ==========================================================================

status_ok=1
printf '\n'
printf 'sandbox left in place: %s\n' "$SANDBOX_ROOT"
printf '  hook log  %s\n' "$HOOK_LOG"
printf '  store     %s\n' "$SPOOL"
printf '  evidence  %s\n' "$EVIDENCE"
printf '  canary    %s (untouched)\n' "$CANARY_DIR"
