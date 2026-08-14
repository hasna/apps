/**
 * bashrc-block: a marker-delimited block spliced into ~/.bashrc ABOVE the
 * stock Ubuntu early-return interactive guard.
 *
 * Why this exists (measured, station17 2026-07-30): `mosh station17 codewith`
 * — and every `ssh stationN <cmd>` — runs bash NON-LOGIN and NON-INTERACTIVE.
 * That shell reads no /etc/profile.d (login-only), and the sshd-spawned bash
 * sources ~/.bashrc INSTEAD of $BASH_ENV (verified: with ~/.bashrc hidden and
 * sshd SetEnv pointing BASH_ENV at the 1.4.0 PATH profile, bun CLIs still did
 * not resolve). Ubuntu's stock ~/.bashrc early-returns for non-interactive
 * shells before any PATH export, so the ONLY hook that reaches these shells is
 * a block in ~/.bashrc that sorts BEFORE that guard. Whole-file management of
 * ~/.bashrc is not an option — the file is user-owned and machine-varied — so
 * this kind splices and drift-checks a delimited block instead.
 */

export const BASHRC_BLOCK_BEGIN = "# >>> hasna station bashrc block >>>";
export const BASHRC_BLOCK_END = "# <<< hasna station bashrc block <<<";

/**
 * The stock Ubuntu guard, both the comment line and the `case $- in` line —
 * either one marks the start of interactive-only territory.
 */
export const BASHRC_GUARD_REGEX = /^# If not running interactively|^case \$- in/m;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate a bashrc-block content payload: first line must be the BEGIN
 * marker, last line the END marker, so the splice can find and replace it.
 */
export function validateBashrcBlockContent(content: string): string | null {
  const lines = content.replace(/\n+$/, "").split("\n");
  if (lines[0] !== BASHRC_BLOCK_BEGIN) {
    return `first line must be the marker "${BASHRC_BLOCK_BEGIN}"`;
  }
  if (lines[lines.length - 1] !== BASHRC_BLOCK_END) {
    return `last line must be the marker "${BASHRC_BLOCK_END}"`;
  }
  return null;
}

/**
 * One idempotent sh command: strip any existing marker-delimited block from
 * the target, then re-insert the shipped content immediately BEFORE the first
 * guard line (or prepend to the whole file when no guard exists). Runs
 * unprivileged as the login user; $HOME is resolved at run time.
 */
export function buildBashrcSpliceCommand(target: string, content: string): string {
  if (!target.startsWith("~/")) {
    throw new Error(`bashrc-block target must be home-relative (~/...), got: ${target}`);
  }
  const rel = shellQuote(target.slice(2));
  // Base64 keeps the rendered command a SINGLE line: a literal newline inside
  // a cloud-init runcmd double-quoted YAML scalar is invalid YAML, and the
  // physical setup runner treats commands as one-liners too.
  const qContentB64 = shellQuote(Buffer.from(content, "utf8").toString("base64"));
  const qBegin = shellQuote(BASHRC_BLOCK_BEGIN);
  const qEnd = shellQuote(BASHRC_BLOCK_END);
  // Grep/awk both match the guard with plain anchored patterns; keep the two
  // in sync with BASHRC_GUARD_REGEX above.
  const guardGrep = shellQuote("^# If not running interactively|^case \\$- in");
  return (
    `rc="$HOME"/${rel} && touch "$rc" && blk=$(mktemp) && tmp=$(mktemp) && ` +
    `printf '%s' ${qContentB64} | base64 -d > "$blk" && ` +
    // Lossless strip (review P1): lines after a BEGIN marker are BUFFERED, not
    // dropped — the buffer is discarded only when the matching END marker
    // arrives, and restored verbatim at EOF when it never does. An orphan
    // BEGIN (a hand-edit deleted the END line) previously turned the next
    // converge into silent truncation of everything below it, guard and user
    // content included.
    `awk -v b=${qBegin} -v e=${qEnd} 'index($0,b)==1 && !skip {skip=1; buf=$0 ORS; next} skip {buf=buf $0 ORS; if(index($0,e)==1){skip=0; buf=""}; next} {print} END{if(skip) printf "%s", buf}' "$rc" > "$tmp" && ` +
    `if grep -qE ${guardGrep} "$tmp"; then ` +
    `awk -v bf="$blk" '!done && (/^# If not running interactively/ || /^case \\$- in/){while((getline l<bf)>0) print l; done=1} {print}' "$tmp" > "$rc"; ` +
    `else cat "$blk" "$tmp" > "$rc"; fi && rm -f "$blk" "$tmp"`
  );
}
