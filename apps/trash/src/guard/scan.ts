/**
 * Source-span scanner — the byte-exact half of the guard.
 *
 * =========================================================================
 * WHY THIS IS NOT `shellWords` / `splitShellSegments`
 * =========================================================================
 *
 * §15 correction (binding) and §3's own correction: the fleet's tokenizers are
 * **decoders**. `shellWords` strips quotes and backslash escapes into a bare
 * `words: string[]` and `rmCommandTargets`'s `tokens.findIndex(...)` yields an
 * **array index, not a byte span** — so `"rm"` and `r\m` both classify as the
 * `rm` verb, and NEITHER can be mapped back to the bytes that produced it
 * (`apps/hooks/hooks/codewith-native-common.ts:253,387`). The fleet's
 * classifier is right to be a decoder: it only ever has to answer *is this
 * dangerous*, and that answer survives decoding.
 *
 * A REWRITING guard asks a different question — *which bytes do I replace* —
 * and that one does not survive decoding. So this module is a second,
 * deliberately small tool that reads the ORIGINAL string and returns byte
 * spans. It is not a replacement for the fleet's classification path and the
 * two never share code.
 *
 * The consequence a first draft of the plan got wrong: the scan must locate a
 * verb only in COMMAND POSITION (start of a segment, or immediately after
 * `;`, `&&`, `||`, `|`, `(`, or after a wrapper). A `findIndex`-style match
 * would rewrite `printf '%s\n' rm` into `printf '%s\n' <guard>` — corrupting an
 * argument, not intercepting a delete.
 *
 * =========================================================================
 * WHAT IT DELIBERATELY DOES NOT DO
 * =========================================================================
 *
 * It never decodes-and-re-encodes. Replacement happens on the source text, so
 * every other byte — quoting, flags, targets, the rest of a compound command —
 * is preserved exactly. Decoding exists for ONE purpose (classifying a word as
 * `rm` vs `rmdir` vs `grep`) and the decoded value is never written back.
 *
 * It does not resolve targets, expand variables, or follow globs. That is the
 * decision layer's job (`plan.ts`), because "is this target protected" needs a
 * home directory and a filesystem while this file stays a pure function of the
 * command string.
 */

/** A half-open byte range `[start, end)` into the original command string. */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

/** One shell word, carrying both of its identities: the bytes, and their meaning. */
export interface ScannedWord {
  /** The exact source slice — quotes and escapes included. Never rewritten. */
  readonly raw: string;
  /** The decoded value (quoting removed). Used for CLASSIFICATION only. */
  readonly text: string;
  readonly span: SourceSpan;
  /** The word contains a command substitution: `$(...)` or backticks. */
  readonly hasSubstitution: boolean;
  /** The word references a variable: `$VAR` or `${VAR}`. */
  readonly hasVariable: boolean;
  /** The word carries an unquoted glob metacharacter: `*`, `?`, `[`. */
  readonly hasGlob: boolean;
}

export type Disposition = "rewrite" | "refuse";

/** A delete verb found in command position, with the span that would be swapped. */
export interface DeleteVerbHit {
  /** The decoded program word, e.g. `rm`, `/bin/rm`, `git rm`, `find -delete`. */
  readonly verb: string;
  readonly disposition: Disposition;
  /**
   * The span to replace when `disposition === "rewrite"` — exactly the program
   * token, so the swap preserves every flag, every target and all quoting
   * byte-for-byte.
   */
  readonly span: SourceSpan;
  /** The whole shell segment this verb belongs to. */
  readonly segment: SourceSpan;
  /** Why the verb is refused (`""` for a rewrite). Written as an instruction. */
  readonly reason: string;
  /** The words after the verb in this segment — the guard's argv tail. */
  readonly args: readonly ScannedWord[];
  /** True when the hit was found inside a `$(...)` or backtick substitution. */
  readonly inSubstitution: boolean;
}

export interface ScanResult {
  readonly hits: readonly DeleteVerbHit[];
  /**
   * The command could not be lexed to the end (unterminated quote,
   * substitution or backtick). When this is true NO span in the command can be
   * trusted, so a verb found earlier must be refused rather than rewritten —
   * §3's "truncated lex" fail rule.
   */
  readonly unterminated: boolean;
}

// =========================================================================
// Lexer
// =========================================================================

type Token =
  | { type: "word"; word: ScannedWord }
  | { type: "op"; text: string; span: SourceSpan }
  | { type: "redirect"; span: SourceSpan };

interface HeredocSpec {
  delimiter: string;
  stripTabs: boolean;
}

interface LexResult {
  tokens: Token[];
  unterminated: boolean;
  /** Command-substitution bodies, as absolute spans into the same string. */
  substitutions: SourceSpan[];
}

/** The lexer's hard ceiling: a pathological string must not become a denial of service. */
const MAX_LEX_BYTES = 1_000_000;

const OPERATOR_CHARS = new Set([";", "&", "|", "(", ")", "\n", "\r"]);
const REDIRECT_CHARS = new Set([">", "<"]);
const WHITESPACE = new Set([" ", "\t"]);

function isOperator(ch: string | undefined): boolean {
  return ch !== undefined && OPERATOR_CHARS.has(ch);
}

function isRedirectStart(command: string, index: number): boolean {
  const ch = command[index];
  if (ch !== undefined && REDIRECT_CHARS.has(ch)) return true;
  // `2>file` — a bare fd prefix immediately followed by a redirect character.
  if (ch === undefined || !/[0-9]/.test(ch)) return false;
  let cursor = index;
  while (cursor < command.length && /[0-9]/.test(command[cursor]!)) cursor += 1;
  return cursor > index && REDIRECT_CHARS.has(command[cursor] ?? "");
}

/** Strip the quoting from a raw word, reporting what the decoding saw on the way. */
function decodeWord(raw: string): {
  text: string;
  hasSubstitution: boolean;
  hasVariable: boolean;
  hasGlob: boolean;
} {
  let text = "";
  let quote: "'" | '"' | null = null;
  let hasSubstitution = false;
  let hasVariable = false;
  let hasGlob = false;
  let index = 0;

  while (index < raw.length) {
    const ch = raw[index]!;
    if (ch === "\\") {
      // Outside single quotes a backslash escapes the next byte; inside single
      // quotes it is a literal byte, which the `quote === "'"` branch keeps.
      if (quote !== "'") {
        text += raw[index + 1] ?? "";
        index += 2;
        continue;
      }
      text += ch;
      index += 1;
      continue;
    }
    if (quote === null && (ch === "'" || ch === '"')) {
      quote = ch;
      index += 1;
      continue;
    }
    if (quote !== null && ch === quote) {
      quote = null;
      index += 1;
      continue;
    }
    // A substitution is copied VERBATIM: its body is a different command and
    // rewriting it here would be a second guess on top of the first.
    if (quote !== "'" && ch === "$" && raw[index + 1] === "(") {
      hasSubstitution = true;
      text += "$(";
      index += 2;
      continue;
    }
    if (quote !== "'" && ch === "`") {
      hasSubstitution = true;
      text += ch;
      index += 1;
      continue;
    }
    if (quote !== "'" && ch === "$") {
      hasVariable = true;
      text += ch;
      index += 1;
      continue;
    }
    if (quote === null && (ch === "*" || ch === "?" || ch === "[")) hasGlob = true;
    text += ch;
    index += 1;
  }
  return { text, hasSubstitution, hasVariable, hasGlob };
}

/**
 * Read one word starting at `index`, or `null` when the position is a boundary
 * (whitespace, an operator, a redirect) rather than a word.
 *
 * The same routine skips over `$( )`, `${ }` and backtick runs so that a word
 * containing them is measured as ONE word with ONE span — which is what keeps
 * `"$(pwd)/x"` from being torn apart at the `(`.
 */
function readWord(
  command: string,
  index: number,
): { word: ScannedWord; next: number; unterminated: boolean; substitutions: SourceSpan[] } | null {
  const start = index;
  if (index >= command.length) return null;
  const first = command[index]!;
  if (WHITESPACE.has(first) || isOperator(first) || isRedirectStart(command, index)) return null;

  let cursor = index;
  let quote: "'" | '"' | null = null;
  let unterminated = false;
  const substitutions: SourceSpan[] = [];

  const skipSubstitution = (open: number, closer: ")" | "`"): number => {
    // `$(` nests (a body may contain `$( )` again) while a backtick run does
    // not; both must ignore operators that appear inside nested quotes.
    let depth = 0;
    let innerQuote: "'" | '"' | null = null;
    for (let i = open; i < command.length; i += 1) {
      const c = command[i]!;
      if (c === "\\" && innerQuote !== "'") {
        i += 1;
        continue;
      }
      if (innerQuote !== null) {
        if (c === innerQuote) innerQuote = null;
        continue;
      }
      if (c === "'" || c === '"') {
        innerQuote = c;
        continue;
      }
      if (closer === ")" && c === "(") depth += 1;
      if (c === closer) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  };

  while (cursor < command.length) {
    const ch = command[cursor]!;
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        cursor += 1;
        continue;
      }
      if (quote === '"' && ch === "$" && command[cursor + 1] === "(") {
        const end = skipSubstitution(cursor + 1, ")");
        if (end === -1) {
          unterminated = true;
          cursor = command.length;
          break;
        }
        substitutions.push({ start: cursor + 2, end: end - 1 });
        cursor = end;
        continue;
      }
      if (quote === '"' && ch === "`") {
        const end = skipSubstitution(cursor, "`");
        if (end === -1) {
          unterminated = true;
          cursor = command.length;
          break;
        }
        substitutions.push({ start: cursor + 1, end: end - 1 });
        cursor = end;
        continue;
      }
      cursor += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cursor += 1;
      continue;
    }
    if (ch === "$" && command[cursor + 1] === "(") {
      const end = skipSubstitution(cursor + 1, ")");
      if (end === -1) {
        unterminated = true;
        cursor = command.length;
        break;
      }
      substitutions.push({ start: cursor + 2, end: end - 1 });
      cursor = end;
      continue;
    }
    if (ch === "$" && command[cursor + 1] === "{") {
      const close = command.indexOf("}", cursor + 2);
      if (close === -1) {
        unterminated = true;
        cursor = command.length;
        break;
      }
      cursor = close + 1;
      continue;
    }
    if (ch === "`") {
      const end = skipSubstitution(cursor, "`");
      if (end === -1) {
        unterminated = true;
        cursor = command.length;
        break;
      }
      substitutions.push({ start: cursor + 1, end: end - 1 });
      cursor = end;
      continue;
    }
    if (WHITESPACE.has(ch) || isOperator(ch) || isRedirectStart(command, cursor)) break;
    cursor += 1;
  }

  // A quote still open at the end of input means the lexer never found the
  // word's boundary — nothing after it can be trusted to be its own token.
  if (quote !== null) unterminated = true;

  const raw = command.slice(start, cursor);
  const decoded = decodeWord(raw);
  return {
    word: {
      raw,
      text: decoded.text,
      span: { start, end: cursor },
      hasSubstitution: decoded.hasSubstitution,
      hasVariable: decoded.hasVariable,
      hasGlob: decoded.hasGlob,
    },
    next: cursor,
    unterminated,
    substitutions,
  };
}

/** Read a redirect operator (`>`, `>>`, `2>`, `&>>`, `<`, `<<`, `<<-`, `<>`). */
function readRedirect(command: string, index: number): { next: number; heredoc: HeredocSpec | null } {
  let cursor = index;
  while (cursor < command.length && /[0-9]/.test(command[cursor]!)) cursor += 1;
  // `&>` and `&>>` are bash shorthands for "both streams".
  if (command[cursor] === "&" && REDIRECT_CHARS.has(command[cursor + 1] ?? "")) cursor += 1;
  const kind = command[cursor]!;
  cursor += 1;
  if (kind === ">") {
    if (command[cursor] === ">" || command[cursor] === "|") cursor += 1;
  } else if (command[cursor] === "<") {
    const stripTabs = command[cursor + 1] === "-";
    cursor += stripTabs ? 2 : 1;
    const spec = readHeredocDelimiter(command, cursor);
    return {
      next: spec.next,
      heredoc: spec.delimiter === null ? null : { delimiter: spec.delimiter, stripTabs },
    };
  }
  return { next: cursor, heredoc: null };
}

function readHeredocDelimiter(command: string, index: number): { next: number; delimiter: string | null } {
  let cursor = index;
  while (cursor < command.length && WHITESPACE.has(command[cursor]!)) cursor += 1;
  const word = readWord(command, cursor);
  if (!word) return { next: cursor, delimiter: null };
  // `<<EOF` and `<<'EOF'` both mean the delimiter EOF; the quoting only
  // disables expansion inside the body, which the scanner does not care about.
  const delimiter = word.word.text;
  return { next: word.next, delimiter: delimiter.length > 0 ? delimiter : null };
}

/**
 * Consume heredoc bodies: they run from the next line until a line equal to
 * their delimiter. Skipping matters because a body is DATA, and scanning it as
 * shell would read `cat <<EOF\nrm -rf x\nEOF` as a delete.
 */
function skipHeredocBodies(command: string, index: number, specs: HeredocSpec[]): number {
  let cursor = index;
  for (const spec of specs) {
    for (;;) {
      if (cursor > command.length) break;
      const lineEnd = command.indexOf("\n", cursor);
      const line = lineEnd === -1 ? command.slice(cursor) : command.slice(cursor, lineEnd);
      const candidate = spec.stripTabs ? line.replace(/^\t+/, "") : line;
      cursor = lineEnd === -1 ? command.length : lineEnd + 1;
      if (candidate === spec.delimiter || lineEnd === -1) break;
    }
  }
  return cursor;
}

function lex(command: string): LexResult {
  const source = command.length > MAX_LEX_BYTES ? command.slice(0, MAX_LEX_BYTES) : command;
  const tokens: Token[] = [];
  const substitutions: SourceSpan[] = [];
  let unterminated = command.length > MAX_LEX_BYTES;
  let pendingHeredocs: HeredocSpec[] = [];
  let index = 0;

  while (index < source.length) {
    const ch = source[index]!;
    if (WHITESPACE.has(ch)) {
      index += 1;
      continue;
    }
    if (ch === "\\" && source[index + 1] === "\n") {
      index += 2;
      continue;
    }
    if (ch === "#") {
      // A `#` starting a word is a comment. `a#b` never reaches this branch:
      // the word reader consumed it.
      const lineEnd = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }
    if (ch === "\n") {
      tokens.push({ type: "op", text: "\n", span: { start: index, end: index + 1 } });
      index += 1;
      if (pendingHeredocs.length > 0) {
        index = skipHeredocBodies(source, index, pendingHeredocs);
        pendingHeredocs = [];
      }
      continue;
    }
    if (isOperator(ch)) {
      let end = index + 1;
      if (source[end] === ch && (ch === "&" || ch === "|" || ch === ";")) end += 1;
      if (ch === "|" && source[end] === "&") end += 1;
      tokens.push({ type: "op", text: source.slice(index, end), span: { start: index, end } });
      index = end;
      continue;
    }
    if (isRedirectStart(source, index)) {
      const redirect = readRedirect(source, index);
      if (redirect.heredoc) pendingHeredocs.push(redirect.heredoc);
      tokens.push({ type: "redirect", span: { start: index, end: redirect.next } });
      index = redirect.next;
      continue;
    }
    const read = readWord(source, index);
    if (!read) {
      // Unreachable: every non-boundary byte above is handled. Advance rather
      // than risk an infinite loop on a hostile string.
      index += 1;
      continue;
    }
    if (read.unterminated) {
      unterminated = true;
      index = source.length;
      break;
    }
    substitutions.push(...read.substitutions);
    tokens.push({ type: "word", word: read.word });
    index = read.next;
  }

  return { tokens, unterminated, substitutions };
}

// =========================================================================
// Command-position analysis
// =========================================================================

/**
 * Words that leave the parser still waiting for a command word.
 *
 * `then`, `do`, `else`, `!` and `{` are followed by a command, so
 * `if x; then rm -rf y; fi` must still find the `rm`. `in` is the deliberate
 * exception: it is followed by a case PATTERN (`case $x in rm) …`), and
 * treating that pattern as a command would rewrite a harmless pattern into a
 * binary path — a syntax error at best.
 */
const COMMAND_INTRODUCERS = new Set([
  "!",
  "time",
  "{",
  "}",
  "if",
  "then",
  "elif",
  "else",
  "while",
  "until",
  "do",
  "for",
  "select",
  "function",
  "coproc",
]);

/** Wrappers the token swap stays valid through: the verb behind them is still the program. */
const TRANSPARENT_WRAPPERS = new Set([
  "env",
  "command",
  "builtin",
  "nice",
  "ionice",
  "nohup",
  "setsid",
  "stdbuf",
  "time",
  "timeout",
  "exec",
  "noglob",
]);

/** Wrappers whose operand NAMES a program instead of running it (`command -v rm`). */
const INSPECTION_WRAPPERS = new Set(["command", "builtin", "type", "which", "whereis", "hash"]);

/** Wrappers that hide what actually runs — the targets are unresolvable. */
const OPAQUE_WRAPPERS = new Set([
  "xargs",
  "eval",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "ash",
  "fish",
  "csh",
  "tcsh",
  "parallel",
  "ssh",
  "docker",
  "podman",
  "nsenter",
  "chroot",
  "unshare",
  "busybox",
  "python",
  "python3",
  "perl",
  "ruby",
  "node",
  "bun",
]);

/** A privilege transition puts the delete outside wave 1's coverage (§12, §14.3). */
const PRIVILEGE_WRAPPERS = new Set(["sudo", "doas", "su", "runuser", "pkexec", "setpriv"]);

/** Options that consume the following word as their value, per wrapper. */
const WRAPPER_OPTIONS_WITH_VALUE: Record<string, Set<string>> = {
  sudo: new Set(["-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--close-from", "-h", "--host", "-r", "--role", "-t", "--type", "-U", "--other-user", "-D", "--chdir", "-R", "--chroot", "-T", "--command-timeout"]),
  doas: new Set(["-u", "-C"]),
  su: new Set(["-c", "--command", "-s", "--shell", "-g", "--group"]),
  runuser: new Set(["-u", "--user", "-g", "--group", "-c", "--command", "-s", "--shell"]),
  pkexec: new Set(["-u", "--user"]),
  setpriv: new Set(["--reuid", "--regid", "--groups", "--inh-caps", "--ambient-caps", "--selinux-label"]),
  nice: new Set(["-n", "--adjustment"]),
  ionice: new Set(["-c", "-n", "-p", "-P", "-u"]),
  timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
  stdbuf: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
  env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
  command: new Set(),
  builtin: new Set(),
};

/** The verbs the guard can reproduce, and the ones it deliberately refuses. */
export const REWRITE_VERBS: readonly string[] = ["rm", "rmdir"];

/**
 * Options that carry a COMMAND as their value. Behind an opaque wrapper
 * (`sh -c '…'`, `su -c "…"`) the only way to see the delete is to scan that
 * string, and a hit found there is REFUSED — the guard will not rewrite text
 * it cannot re-insert byte-for-byte.
 */
const COMMAND_STRING_OPTIONS = new Set(["-c", "--command"]);

/** `NAME=value` — a variable assignment PREFIX, not a program (`FOO=1 rm -rf x`). */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const REFUSE_VERBS: Record<string, string> = {
  shred:
    "`shred` overwrites a file before unlinking it, which the guard cannot reproduce. Re-run with `rm -- <path>` if you mean to delete it — it will land in the trash.",
  unlink:
    "`unlink` takes no flags and a single path, so the guard will not stand in for it. Re-run with `rm -- <path>` — it will land in the trash.",
};

function basenameOf(program: string): string {
  const trimmed = program.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

interface VerbClass {
  verb: string;
  disposition: Disposition;
  reason: string;
}

function classifyVerb(program: ScannedWord): VerbClass | null {
  const base = basenameOf(program.text);
  if (base === "rm" || base === "rmdir") return { verb: base, disposition: "rewrite", reason: "" };
  if (base in REFUSE_VERBS) return { verb: base, disposition: "refuse", reason: REFUSE_VERBS[base]! };
  return null;
}

/**
 * `git rm`, `git clean`, `find -delete` and `find -exec rm` are delete verbs in
 * a grammar the guard cannot swap a token in: `git rm --cached` must NOT remove
 * the working file, `find -delete` has no leading verb token at all. They are
 * refused rather than approximated (§15 correction 9).
 */
function classifyCompoundVerb(program: ScannedWord, words: readonly ScannedWord[]): VerbClass | null {
  const base = basenameOf(program.text);
  if (base === "git" || base === "git.exe") {
    for (const word of words) {
      if (word.text.startsWith("-")) continue;
      const sub = basenameOf(word.text);
      if (sub === "rm") {
        return {
          verb: "git rm",
          disposition: "refuse",
          reason:
            "`git rm` stages a deletion in the index — the guard cannot reproduce it, and `git rm --cached` does not touch the working file at all. Re-run with `rm -- <path>` if you mean to delete the file (it will land in the trash), or use `git rm` knowingly from an unguarded shell.",
        };
      }
      if (sub === "clean") {
        return {
          verb: "git clean",
          disposition: "refuse",
          reason:
            "`git clean` deletes untracked files with its own rules, which the guard cannot reproduce. Re-run with `rm -- <path>` so the delete lands in the trash.",
        };
      }
      break;
    }
    return null;
  }
  if (base === "find" || base === "fd") {
    for (const word of words) {
      if (word.text === "-delete" || word.text === "--delete") {
        return {
          verb: "find -delete",
          disposition: "refuse",
          reason:
            "`find -delete` deletes whatever the traversal matches, which the guard cannot enumerate before it runs. Re-run with explicit paths, e.g. `rm -rf -- ./build`.",
        };
      }
      if (word.text === "-exec" || word.text === "-execdir" || word.text === "-ok" || word.text === "-okdir") {
        return {
          verb: "find -exec",
          disposition: "refuse",
          reason:
            "`find -exec` runs a command the guard cannot see, so a delete inside it cannot be intercepted. Re-run the delete directly with explicit paths.",
        };
      }
    }
    return null;
  }
  return null;
}

interface SegmentWindow {
  /** Index of the token that starts the segment. */
  start: number;
  /** Index one past the last token of the segment. */
  end: number;
  span: SourceSpan;
}

function segmentWindows(tokens: Token[], commandLength: number): Map<number, SegmentWindow> {
  const windows = new Map<number, SegmentWindow>();
  let start = 0;
  for (let i = 0; i <= tokens.length; i += 1) {
    const isBoundary = i === tokens.length || tokens[i]!.type === "op";
    if (!isBoundary) continue;
    const spanStart = start === 0 ? 0 : spanOf(tokens[start - 1]!).end;
    const spanEnd = i >= tokens.length ? commandLength : spanOf(tokens[i]!).start;
    for (let j = start; j <= i; j += 1) {
      windows.set(j, { start, end: i, span: { start: spanStart, end: spanEnd } });
    }
    start = i + 1;
  }
  return windows;
}

function spanOf(token: Token): SourceSpan {
  switch (token.type) {
    case "word":
      return token.word.span;
    case "op":
    case "redirect":
      return token.span;
  }
}

function wordsAfter(tokens: Token[], index: number, segmentEnd: number): ScannedWord[] {
  const words: ScannedWord[] = [];
  for (let i = index + 1; i < segmentEnd; i += 1) {
    const token = tokens[i]!;
    if (token.type === "word") words.push(token.word);
  }
  return words;
}

function opaqueReason(opaque: ScannedWord): string {
  const name = basenameOf(opaque.text);
  if (name === "xargs" || name === "parallel") {
    return `\`${name}\` builds the argument list the delete receives, so the guard cannot enumerate its targets before it runs. Re-run the delete directly with literal paths, e.g. \`rm -rf -- ./build\`.`;
  }
  if (name === "eval") {
    return "`eval` builds a command string the guard cannot read, so the delete inside it cannot be rewritten. Re-run the delete directly with a literal path.";
  }
  return `a delete behind \`${name}\` runs in a context the guard cannot rewrite. Re-run the delete directly with literal paths, e.g. \`rm -rf -- ./build\`.`;
}

function privilegeReason(privilege: ScannedWord): string {
  return `\`${basenameOf(privilege.text)}\` is a privilege transition: the delete would run as another user and never reach this guard. Wave 1 does not cover that case — re-run the delete as the owning user, or delete the path explicitly yourself.`;
}

/**
 * Scan a command string for delete verbs in command position.
 *
 * Pure: no filesystem, no environment, no clock. Every returned span indexes
 * the string that was passed in.
 */
export function scanDeleteVerbs(command: string): ScanResult {
  const { tokens, unterminated, substitutions } = lex(command);
  const hits: DeleteVerbHit[] = [];
  const seen = new Set<string>();
  const windows = segmentWindows(tokens, command.length);

  const push = (hit: DeleteVerbHit): void => {
    const key = `${hit.span.start}:${hit.span.end}:${hit.verb}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  let expected = true;
  let chain: ScannedWord[] = [];
  let opaque: ScannedWord | null = null;
  let privilege: ScannedWord | null = null;
  let inspectionOnly = false;
  let skipOperand = false;
  // `case WORD in PATTERN) CMD ;; esac`: neither the subject nor a pattern is a
  // command, and both are ordinary words the rest of the shell grammar would
  // otherwise read as one.
  let caseSubjectPending = false;
  let awaitingIn = false;
  let inPattern = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const window = windows.get(i)!;
    if (token.type === "op") {
      if (token.text === ")") inPattern = false;
      expected = true;
      chain = [];
      opaque = null;
      privilege = null;
      inspectionOnly = false;
      skipOperand = false;
      caseSubjectPending = false;
      awaitingIn = false;
      continue;
    }
    if (token.type === "redirect") {
      // The redirect's file operand is a path, never a program.
      const next = tokens[i + 1];
      if (next && next.type === "word") {
        i += 1;
      }
      continue;
    }

    const word = token.word;
    const base = basenameOf(word.text);
    const isOption = word.text.startsWith("-") && word.text.length > 1;

    if (word.text === "esac") {
      inPattern = false;
      awaitingIn = false;
      expected = false;
      continue;
    }

    // Behind an opaque or privilege wrapper there is no argument structure to
    // reason about, so EVERY remaining word in the segment is suspect: a word
    // that IS a delete verb, an option's value that CONTAINS one, or a bare
    // operand that is itself a command string (`ssh host 'rm -rf /'`).
    if (opaque || privilege) {
      const reason = opaque ? opaqueReason(opaque) : privilegeReason(privilege!);
      const verb = classifyVerb(word) ?? classifyCompoundVerb(word, wordsAfter(tokens, i, window.end));
      if (verb) {
        push({
          verb: verb.verb,
          disposition: "refuse",
          span: word.span,
          segment: window.span,
          reason,
          args: wordsAfter(tokens, i, window.end),
          inSubstitution: false,
        });
        continue;
      }
      const wrapper = basenameOf((opaque ?? privilege)!.text);
      const withValue = WRAPPER_OPTIONS_WITH_VALUE[wrapper];
      const takesValue =
        COMMAND_STRING_OPTIONS.has(word.text) || (withValue !== undefined && withValue.has(word.text.split("=")[0]!));
      const next = tokens[i + 1];
      if (isOption && takesValue && next && next.type === "word") {
        const embedded = scanEmbeddedText(next.word);
        if (embedded) {
          push({
            verb: embedded.verb,
            disposition: "refuse",
            span: next.word.span,
            segment: window.span,
            reason: `${reason} The command it was given contains a delete.`,
            args: [],
            inSubstitution: false,
          });
        }
        i += 1;
        continue;
      }
      if (!isOption && word.text.length > 0) {
        const embedded = scanEmbeddedText(word);
        if (embedded) {
          push({
            verb: embedded.verb,
            disposition: "refuse",
            span: word.span,
            segment: window.span,
            reason,
            args: [],
            inSubstitution: false,
          });
        }
      }
      continue;
    }

    // Wrapper options are never the program: `command -v rm` inspects, and
    // `sudo -u root rm …` must consume `root` before reaching `rm`.
    if (chain.length > 0 && isOption) {
      const wrapper = basenameOf(chain[0]!.text);
      if (INSPECTION_WRAPPERS.has(wrapper) && /^-[a-zA-Z]*[vV]/.test(word.text)) {
        inspectionOnly = true;
        expected = true;
        continue;
      }
      const withValue = WRAPPER_OPTIONS_WITH_VALUE[wrapper];
      if ((withValue && withValue.has(word.text.split("=")[0]!)) || wrapper === "timeout") {
        skipOperand = true;
        expected = true;
        continue;
      }
      expected = true;
      continue;
    }

    if (!expected) continue;

    // ---- command position ------------------------------------------------
    if (skipOperand) {
      // `timeout 5 rm …`: the duration (or an option's value) is not a program.
      skipOperand = false;
      continue;
    }
    if (caseSubjectPending) {
      caseSubjectPending = false;
      awaitingIn = true;
      continue;
    }
    if (awaitingIn) {
      if (word.text === "in") {
        awaitingIn = false;
        inPattern = true;
      }
      continue;
    }
    if (word.text === "case") {
      caseSubjectPending = true;
      continue;
    }
    if (inPattern) continue;
    // `FOO=1 rm -rf x` — an assignment is a prefix; the program still follows.
    if (ASSIGNMENT.test(word.text)) continue;
    if (COMMAND_INTRODUCERS.has(base)) continue;

    if (TRANSPARENT_WRAPPERS.has(base) || OPAQUE_WRAPPERS.has(base) || PRIVILEGE_WRAPPERS.has(base)) {
      chain.push(word);
      if (OPAQUE_WRAPPERS.has(base)) opaque = word;
      if (PRIVILEGE_WRAPPERS.has(base)) privilege = word;
      if (base === "type" || base === "which" || base === "whereis" || base === "hash") inspectionOnly = true;
      // `timeout 5 rm …` consumes one operand (the duration) before the program.
      if (base === "timeout") skipOperand = true;
      continue;
    }

    if (inspectionOnly) {
      // `command -v rm` / `which rm`: the word names a program, it does not run it.
      expected = false;
      inspectionOnly = false;
      continue;
    }

    const compound = classifyCompoundVerb(word, wordsAfter(tokens, i, window.end));
    const verb = compound ?? classifyVerb(word);
    if (verb) {
      push({
        verb: verb.verb,
        disposition: verb.disposition,
        // A `git rm` / `find -delete` hit is refused; its span is the program
        // token, which is never rewritten because the disposition forbids it.
        span: word.span,
        segment: window.span,
        reason: verb.reason,
        args: wordsAfter(tokens, i, window.end),
        inSubstitution: false,
      });
    }
    expected = false;
    chain = [];
  }

  // A command substitution is a command too: a delete inside one is a delete
  // the guard cannot rewrite in place, so it is surfaced (and refused) rather
  // than silently missed.
  for (const body of substitutions) {
    if (body.end <= body.start) continue;
    const inner = scanDeleteVerbs(command.slice(body.start, body.end));
    if (inner.hits.length === 0) continue;
    const first = inner.hits[0]!;
    push({
      verb: first.verb,
      disposition: "refuse",
      span: { start: body.start + first.span.start, end: body.start + first.span.end },
      segment: { start: body.start + first.segment.start, end: body.start + first.segment.end },
      reason:
        "a delete inside a command substitution (`$(…)` or backticks) runs before the guard sees the command, so it cannot be intercepted. Re-run the delete as its own command with a literal path, e.g. `rm -rf -- ./build`.",
      args: [],
      inSubstitution: true,
    });
    if (inner.unterminated) return { hits, unterminated: true };
  }

  return { hits: hits.sort((a, b) => a.span.start - b.span.start), unterminated };
}

/**
 * `sh -c 'rm -rf x'` / `su -c "…"`: the command is a STRING, and the only way
 * to see the delete inside it is to scan the string. Nothing is rewritten
 * from here — the hit exists so the decision layer can refuse the whole
 * command instead of letting an unreadable delete run.
 */
function scanEmbeddedText(word: ScannedWord): VerbClass | null {
  if (word.text.length === 0) return null;
  const inner = scanDeleteVerbs(word.text);
  const hit = inner.hits[0];
  if (!hit) return null;
  return { verb: hit.verb, disposition: "refuse", reason: "" };
}

// =========================================================================
// Rewriting
// =========================================================================

export interface SpanEdit {
  readonly span: SourceSpan;
  readonly text: string;
}

/**
 * Replace exactly the given spans, leaving every other byte alone.
 *
 * Edits are applied right-to-left so an earlier replacement cannot shift a
 * later span — the offsets are the whole point of this module, and
 * left-to-right application would silently corrupt the second edit.
 */
export function applySpanEdits(command: string, edits: readonly SpanEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.span.start - a.span.start);
  let out = command;
  for (const edit of ordered) {
    out = out.slice(0, edit.span.start) + edit.text + out.slice(edit.span.end);
  }
  return out;
}

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote one word for re-insertion into a command string. The spool path
 * travels inside the command TEXT the hook writes, so a path with a space
 * would otherwise split the rewritten command into two words and change the
 * delete's meaning.
 */
export function quoteForShell(text: string): string {
  if (text.length > 0 && SAFE_WORD.test(text)) return text;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Decode a single source word — exported so the decision layer can reuse it. */
export function decodeSourceWord(raw: string): string {
  return decodeWord(raw).text;
}
