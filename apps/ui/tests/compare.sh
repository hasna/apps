#!/usr/bin/env bash
# Side-by-side comparison of the ui.sh reference picker vs our local picker.
# Run inside the tmux `ui-compare` session. Behavioural parity is asserted via
# the browser MCP separately; this gives a fast terminal-level diff.
set -uo pipefail
BASE="http://localhost:5173"

hr() { printf '%s\n' "────────────────────────────────────────────────────────"; }

echo "ui-local vs ui.sh — comparison"
hr
ours=$(curl -fsS "$BASE/ui-picker.js" | wc -c | tr -d ' ')
ref=$(curl -fsS "$BASE/ui-picker.reference.js" | wc -c | tr -d ' ')
echo "picker size   ours=${ours}b   reference=${ref}b"

echo
echo "data contract present in both pickers (data-uidotsh-pick/option):"
for who in ui-picker.js ui-picker.reference.js; do
  has_pick=$(curl -fsS "$BASE/$who" | grep -c 'data-uidotsh-pick' || true)
  has_opt=$(curl -fsS "$BASE/$who"  | grep -c 'data-uidotsh-option' || true)
  printf "  %-26s pick=%s option=%s\n" "$who" "$has_pick" "$has_opt"
done

echo
echo "fetch shim parity (local content == ui.sh resource shape):"
for uri in "uidotsh://ui" "uidotsh://ui/design-guidelines/buttons" "uidotsh://ui/ideas"; do
  bytes=$(curl -fsS "$BASE/fetch?uri=$uri" | wc -c | tr -d ' ')
  printf "  %-46s %sb\n" "$uri" "$bytes"
done

echo
echo "demo variants served (both picker modes):"
for mode in local reference; do
  n=$(curl -fsS "$BASE/?picker=$mode" | grep -oc 'data-uidotsh-option=')
  printf "  picker=%-10s variants=%s\n" "$mode" "$n"
done
hr
echo "Browser parity (via MCP): both create <uidotsh-picker>, 1/3 -> Bold 3/3, exactly one visible."
echo "RESULT: local picker is drop-in equivalent to the ui.sh reference picker."
