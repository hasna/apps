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
export declare const BASHRC_BLOCK_BEGIN = "# >>> hasna station bashrc block >>>";
export declare const BASHRC_BLOCK_END = "# <<< hasna station bashrc block <<<";
/**
 * The stock Ubuntu guard, both the comment line and the `case $- in` line —
 * either one marks the start of interactive-only territory.
 */
export declare const BASHRC_GUARD_REGEX: RegExp;
/**
 * Validate a bashrc-block content payload: first line must be the BEGIN
 * marker, last line the END marker, so the splice can find and replace it.
 */
export declare function validateBashrcBlockContent(content: string): string | null;
/**
 * One idempotent sh command: strip any existing marker-delimited block from
 * the target, then re-insert the shipped content immediately BEFORE the first
 * guard line (or prepend to the whole file when no guard exists). Runs
 * unprivileged as the login user; $HOME is resolved at run time.
 */
export declare function buildBashrcSpliceCommand(target: string, content: string): string;
