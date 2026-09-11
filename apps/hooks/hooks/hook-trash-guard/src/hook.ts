#!/usr/bin/env bun

/**
 * PreToolUse hook: trash-guard
 *
 * Intercepts `rm` issued through the Bash tool and rewrites it into
 * `<abs>/trash guard <same args>` (the `@hasna/trash` guard subcommand), so
 * the delete lands in a trash store instead of being unrecoverable.
 *
 * Self-contained block decision. This hook NEVER consults a store, a network,
 * a credential or the `@hasna/trash` package internals to decide whether to
 * refuse a delete: it either has a trash binary to redirect to, or it refuses
 * the command. There is no path in which a delete it cannot redirect is
 * silently allowed:
 *
 *   trash absent  -> permissionDecision "deny" with a reason
 *   trash present -> updatedInput rewrite to `<abs>/trash guard <same args>`
 *
 * Output contract (deliberately narrow):
 *   - no delete verb           -> emit nothing (stay silent and cheap)
 *   - rewritable `rm`          -> permissionDecision "allow" + a COMPLETE
 *                                 updatedInput, and nothing else
 *   - anything else            -> permissionDecision "deny" + a reason
 *
 * A malformed rewrite is worse than a refusal: the harness falls back to the
 * ORIGINAL tool input when `updatedInput` is missing or empty, which runs the
 * raw `rm`. So the rewrite path emits a complete schema-valid tool_input
 * (every key the model supplied, plus command/description/timeout/
 * run_in_background, plus dangerouslyDisableSandbox when it was present) and
 * re-verifies the rewritten text before allowing it — if the verification
 * fails, the hook denies instead of allowing a partial rewrite.
 *
 * Scope and ownership:
 *   - Only `rm`'s own grammar is rewritten. `rmdir`, `unlink`, `shred`,
 *     `git rm`, `git clean` and `find -delete` are REFUSED with a reason —
 *     their flags and semantics are not `rm`'s, and a wrong rewrite is silent
 *     where a refusal is visible.
 *   - Deletes under the protected repo-checkout roots
 *     (`$HOME/.hasna/repos/clones`, `$HOME/workspace/repos`) belong to the
 *     `workspace-repos-guard` hook, which blocks them. This hook abstains
 *     there: it does not restate that policy, it hands the command over. A
 *     command that mixes an owned `rm` with a handed-over one is refused
 *     rather than partially rewritten.
 *
 * Fail-closed on internal error: if evaluation throws, the hook denies a
 * command that contains a delete-verb word and stays silent otherwise.
 */

import { homedir } from "os";
import { isAbsolute, join, normalize, resolve, sep } from "path";
import { statSync } from "fs";
import {
  SYSTEM_PROTECTED_ROOTS,
  getCommand,
  readInput,
  respond,
  warn,
  type CodewithHookInput,
  type CodewithHookOutput,
} from "../../codewith-native-common";

const RULE = "trash-guard";

/**
 * Default Bash-tool timeout (ms) re-supplied on the rewrite. The rewritten
 * command is a same-device move, not a byte copy, so it is fast; an explicit
 * value keeps the rewritten tool_input complete.
 */
const DEFAULT_TIMEOUT_MS = 120000;

/** Description supplied only when the model did not provide one. */
const DEFAULT_DESCRIPTION = "Delete via trash guard (rm intercepted and made recoverable)";

/**
 * Protected repo-checkout roots. The POLICY for these roots — block every
 * delete under them — belongs to `hook-workspace-repos-guard`; this hook only
 * needs to know where the handoff boundary is so it does not shadow it.
 */
const HANDOFF_ROOTS = [".hasna/repos/clones", "workspace/repos"] as const;

/**
 * The catastrophic class (§15 decision 11.3): the filesystem root, the home
 * directory itself, the Hasna state root, the credential stores, and the
 * system roots the `pre-bash` hook's protected-path rules already name. A
 * delete on one of these is refused outright — never rewritten, never trashed.
 * Keep the list in step with `pre-bash`'s protected roots.
 */
const PROTECTED_HOME_TREES = [".hasna", ".ssh", ".aws"] as const;

/** Delete verbs that are refused rather than rewritten, with their reason. */
const REFUSED_VERBS: Record<string, string> = {
  rmdir:
    "`rmdir` is a delete that trash-guard does not rewrite (it takes rmdir's flags, not rm's). Re-run it as `rm -d -- <path>` for an empty directory, or `rm -r -- <path>` for a non-empty one, and it is redirected into trash.",
  unlink:
    "`unlink` is a delete that trash-guard does not rewrite. Re-run it as `rm -- <path>` and it is redirected into trash.",
  shred:
    "`shred` destroys content irrecoverably and is never allowed. Re-run it as `rm -- <path>` and it is redirected into trash.",
};

/**
 * Commands whose own argument string is a shell command we cannot rewrite in
 * place. When one of these is in command position and the command mentions a
 * delete verb, the command is refused rather than guessed at.
 */
const OPAQUE_COMMANDS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "eval", "source", ".", "su", "runuser"]);

/** Wrapper commands whose real command follows them (with their value-taking options). */
const WRAPPERS: Record<string, string[]> = {
  sudo: ["-u", "--user", "-g", "--group", "-p", "--prompt", "-C", "--chdir", "-h", "--host", "-r", "--role", "-t", "--type", "-U", "--other-user"],
  doas: ["-u", "-C"],
  env: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "--class", "-n", "--classdata", "-p", "--pid"],
  stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
  time: ["-f", "--format", "-o", "--output"],
  timeout: ["-s", "--signal", "-k", "--kill-after"],
  nohup: [],
  setsid: [],
  command: [],
  builtin: [],
  exec: [],
};

/**
 * Wrappers that consume positional arguments before their real command:
 * `timeout 5 rm -rf x` runs `rm`, so the duration is skipped, not read as the
 * verb.
 */
const WRAPPER_POSITIONALS: Record<string, number> = {
  timeout: 1,
};

/**
 * Applet dispatchers. `busybox rm` is a different `rm` implementation whose
 * flags are not GNU's, so its deletes are refused rather than rewritten.
 */
const APPLET_DISPATCHERS = new Set(["busybox", "toybox"]);

/** Shell keywords that may precede the real command in a segment. */
const KEYWORDS = new Set(["!", "{", "}", "then", "do", "else", "elif", "if", "while", "until", "for", "case", "esac", "fi", "done", "select", "function"]);

/** git's value-taking global options, skipped before the subcommand. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

/** Delete verbs an opaque command string might carry. */
const DELETE_VERB_WORD_RE = /(^|[^A-Za-z0-9_.-])(rm|rmdir|unlink|shred)(?![A-Za-z0-9_.-])/;

/**
 * Whether a command string mentions a delete verb as its own word, once
 * quoting is stripped. Used only where the command cannot be classified
 * structurally (an opaque shell string, an unterminated command, a hook
 * failure) — never to justify a rewrite, only a refusal.
 */
export function mentionsDeleteVerb(text: string): boolean {
  return DELETE_VERB_WORD_RE.test(decodeWord(text));
}

const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The command name inside a word: `/bin/rm` and `./rm` are `rm`. A path-prefixed
 * verb is still the same verb, and the swap replaces the whole word.
 */
function baseVerb(word: string): string {
  const slash = word.lastIndexOf("/");
  return slash >= 0 ? word.slice(slash + 1) : word;
}

export interface Word {
  /** Raw source text of the word, including its quotes and escapes. */
  text: string;
  /** Byte offset of the word start in the original command string. */
  start: number;
  /** Byte offset just past the word end in the original command string. */
  end: number;
}

interface Segment {
  words: Word[];
  /** Indices into `words` that are redirection targets, not operands. */
  redirects: Set<number>;
}

interface LexResult {
  segments: Segment[];
  /** False when a quote/substitution/heredoc could not be followed to its end. */
  trustworthy: boolean;
  /** Bodies of `$(...)` and backtick substitutions, in source order. */
  substitutions: string[];
}

/** A reason this hook refuses a command. */
interface Refusal {
  reason: string;
}

/** One `rm` verb located in command position, with the span of its verb token. */
interface RmHit {
  word: Word;
  operands: Word[];
}

export interface ScanResult {
  rmHits: RmHit[];
  /** `rm` invocations deliberately left to workspace-repos-guard. */
  handoffHits: RmHit[];
  refusals: Refusal[];
  /** Deletes on the protected class (§15 decision 11.3) — refused, never redirected. */
  protectedHits: Refusal[];
  trustworthy: boolean;
}

/* ------------------------------------------------------------------ */
/* Lexer — source spans, not decoded tokens                            */
/* ------------------------------------------------------------------ */

/**
 * Split a command string into segments and words while recording each word's
 * byte span in the ORIGINAL string. Quoting is tracked rather than decoded so
 * a rewrite can replace exactly the verb token and leave every other byte —
 * flags, quoting, globs, variables, substitutions — untouched.
 */
export function lexCommand(command: string): LexResult {
  const segments: Segment[] = [];
  const substitutions: string[] = [];
  let words: Word[] = [];
  let redirects = new Set<number>();
  let wordStart = -1;
  let pendingRedirect = false;
  let trustworthy = true;
  let i = 0;
  const n = command.length;

  const closeWord = (end: number): void => {
    if (wordStart >= 0) {
      const index = words.length;
      words.push({ text: command.slice(wordStart, end), start: wordStart, end });
      if (pendingRedirect) redirects.add(index);
      wordStart = -1;
    }
    pendingRedirect = false;
  };

  const closeSegment = (end: number): void => {
    closeWord(end);
    if (words.length > 0) segments.push({ words, redirects });
    words = [];
    redirects = new Set<number>();
  };

  const scanSingle = (from: number): number => {
    const end = command.indexOf("'", from + 1);
    return end === -1 ? -1 : end + 1;
  };

  const scanBacktick = (from: number): number => {
    let j = from + 1;
    while (j < n) {
      if (command[j] === "\\") {
        j += 2;
        continue;
      }
      if (command[j] === "`") return j + 1;
      j++;
    }
    return -1;
  };

  const scanParen = (from: number): number => {
    let depth = 0;
    let j = from;
    while (j < n) {
      const c = command[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "'") {
        const e = scanSingle(j);
        if (e < 0) return -1;
        j = e;
        continue;
      }
      if (c === '"') {
        const e = scanDouble(j);
        if (e < 0) return -1;
        j = e;
        continue;
      }
      if (c === "`") {
        const e = scanBacktick(j);
        if (e < 0) return -1;
        j = e;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return -1;
  };

  function scanDouble(from: number): number {
    let j = from + 1;
    while (j < n) {
      const c = command[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === '"') return j + 1;
      if (c === "`") {
        const e = scanBacktick(j);
        if (e < 0) return -1;
        j = e;
        continue;
      }
      if (c === "$" && command[j + 1] === "(") {
        const e = scanParen(j + 1);
        if (e < 0) return -1;
        j = e;
        continue;
      }
      j++;
    }
    return -1;
  }

  while (i < n) {
    const ch = command[i];

    if (ch === " " || ch === "\t" || ch === "\r") {
      closeWord(i);
      i++;
      continue;
    }
    if (ch === "\n") {
      closeSegment(i);
      i++;
      continue;
    }
    if (ch === ";") {
      closeSegment(i);
      i++;
      continue;
    }
    if (ch === "&") {
      closeSegment(i);
      i += command[i + 1] === "&" ? 2 : 1;
      continue;
    }
    if (ch === "|") {
      closeSegment(i);
      i += command[i + 1] === "|" ? 2 : 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      closeSegment(i);
      i++;
      continue;
    }
    if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      // A here-document body is data, not a command: skip it whole so its
      // text is never classified as a delete, and never rewritten.
      const marker = command.slice(i + 2).match(/^-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
      if (!marker) {
        trustworthy = false;
        i = n;
        continue;
      }
      const bodyStart = command.indexOf("\n", i + 2 + marker[0].length);
      if (bodyStart === -1) {
        trustworthy = false;
        i = n;
        continue;
      }
      const rest = command.slice(bodyStart + 1);
      const endIdx = findHeredocEnd(rest, marker[2]);
      if (endIdx === -1) {
        trustworthy = false;
        i = n;
        continue;
      }
      closeWord(i);
      i = bodyStart + 1 + endIdx + marker[2].length;
      continue;
    }
    if (ch === ">" || ch === "<") {
      closeWord(i);
      pendingRedirect = true;
      i += command[i + 1] === ch && ch === ">" ? 2 : 1;
      continue;
    }
    if (ch === "'") {
      if (wordStart < 0) wordStart = i;
      const e = scanSingle(i);
      if (e < 0) {
        trustworthy = false;
        i = n;
      } else i = e;
      continue;
    }
    if (ch === '"') {
      if (wordStart < 0) wordStart = i;
      const e = scanDouble(i);
      if (e < 0) {
        trustworthy = false;
        i = n;
      } else i = e;
      continue;
    }
    if (ch === "`") {
      if (wordStart < 0) wordStart = i;
      const e = scanBacktick(i);
      if (e < 0) {
        trustworthy = false;
        i = n;
      } else {
        substitutions.push(command.slice(i + 1, e - 1));
        i = e;
      }
      continue;
    }
    if (ch === "$" && command[i + 1] === "(") {
      if (wordStart < 0) wordStart = i;
      const e = scanParen(i + 1);
      if (e < 0) {
        trustworthy = false;
        i = n;
      } else {
        substitutions.push(command.slice(i + 2, e - 1));
        i = e;
      }
      continue;
    }
    if (ch === "\\") {
      if (wordStart < 0) wordStart = i;
      if (i + 1 >= n) {
        trustworthy = false;
        i = n;
      } else i += 2;
      continue;
    }

    if (wordStart < 0) wordStart = i;
    i++;
  }

  closeSegment(n);
  return { segments, trustworthy, substitutions };
}

/** Offset of the here-document terminator line inside `rest`, or -1. */
function findHeredocEnd(rest: string, delimiter: string): number {
  let from = 0;
  while (from <= rest.length) {
    const at = rest.indexOf(delimiter, from);
    if (at === -1) return -1;
    const lineStart = at === 0 || rest[at - 1] === "\n";
    const after = at + delimiter.length;
    const lineEnd = after === rest.length || rest[after] === "\n" || rest[after] === "\r";
    if (lineStart && lineEnd) return at;
    from = at + 1;
  }
  return -1;
}

/** Strip one word's quoting and escapes, the way the shell would for a name. */
export function decodeWord(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      if (i + 1 < text.length) out += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) {
        out += text.slice(i + 1);
        break;
      }
      out += text.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        out += text[i];
        i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Command-position analysis                                           */
/* ------------------------------------------------------------------ */

/**
 * Index of the command-position word in a segment, or -1 when the segment has
 * no command (a bare assignment, an empty segment). Command position is the
 * first word, skipping assignment prefixes, shell keywords and recognized
 * command wrappers — NOT any word that happens to read like a verb, so
 * `printf '%s\n' rm` is not a delete.
 */
function commandWordIndex(segment: Segment): number {
  let index = 0;
  let guard = 0;
  while (index < segment.words.length && guard++ < 32) {
    const raw = segment.words[index].text;
    const decoded = decodeWord(raw);
    if (ASSIGNMENT_RE.test(decoded) && !decoded.startsWith("-")) {
      index++;
      continue;
    }
    if (KEYWORDS.has(decoded)) {
      index++;
      continue;
    }
    const wrapperValues = WRAPPERS[decoded];
    if (wrapperValues) {
      index++;
      while (index < segment.words.length) {
        const option = decodeWord(segment.words[index].text);
        if (!option.startsWith("-") || option === "-") break;
        if (option === "--") {
          index++;
          break;
        }
        index++;
        if (wrapperValues.includes(option)) index++;
      }
      let positionals = WRAPPER_POSITIONALS[decoded] ?? 0;
      while (positionals > 0 && index < segment.words.length) {
        const positional = decodeWord(segment.words[index].text);
        if (positional.startsWith("-") && positional !== "-") break;
        index++;
        positionals--;
      }
      continue;
    }
    return index;
  }
  return -1;
}

/** Operand words of an `rm` whose verb is at `verbIndex`. */
function rmOperands(segment: Segment, verbIndex: number): Word[] {
  const operands: Word[] = [];
  let seenDoubleDash = false;
  for (let index = verbIndex + 1; index < segment.words.length; index++) {
    if (segment.redirects.has(index)) continue;
    const decoded = decodeWord(segment.words[index].text);
    if (!seenDoubleDash) {
      if (decoded === "--") {
        seenDoubleDash = true;
        continue;
      }
      if (decoded.startsWith("-") && decoded !== "-") continue;
    }
    operands.push(segment.words[index]);
  }
  return operands;
}

/* ------------------------------------------------------------------ */
/* Handoff to workspace-repos-guard                                    */
/* ------------------------------------------------------------------ */

function handoffRoots(home: string): string[] {
  return HANDOFF_ROOTS.map((suffix) => join(home, ...suffix.split("/")));
}

/** Expand `~`, `$HOME`, `${HOME}` spellings to the resolved home directory. */
export function expandHomeSpelling(token: string, home: string): string {
  if (token === "~" || token === "$HOME" || token === "${HOME}") return home;
  if (token.startsWith("~/")) return join(home, token.slice(2));
  if (token.startsWith("$HOME/")) return join(home, token.slice("$HOME/".length));
  if (token.startsWith("${HOME}/")) return join(home, token.slice("${HOME}/".length));
  return token;
}

/**
 * Absolute path of a literal operand, or null when the operand cannot be
 * resolved before expansion (a variable, a glob, an unexpanded substitution).
 * Unresolvable operands are treated as outside the handoff roots: the hook
 * still rewrites them, and `trash guard` classifies what the shell expands.
 */
export function resolveLiteralTarget(raw: string, cwd: string, home: string): string | null {
  let decoded = decodeWord(raw);
  if (!decoded) return null;
  if (decoded.includes("`")) return null;
  // A bare `$HOME`/`${HOME}` is the home directory itself, not a relative path.
  if (decoded === "$HOME" || decoded === "${HOME}" || decoded === "$HOME/" || decoded === "${HOME}/") return home;
  const withoutHome = decoded.replace(/\$\{HOME\}/g, "").replace(/\$HOME/g, "");
  if (withoutHome.includes("$")) return null;
  if (/[*?[\]]/.test(decoded)) return null;
  if (decoded.startsWith("~")) {
    const expanded = expandHomeSpelling(decoded, home);
    if (expanded === decoded) return null; // ~user form — another user's home
    decoded = expanded;
  }
  const absolute = isAbsolute(decoded) ? normalize(decoded) : resolve(cwd, decoded);
  const trimmed = absolute.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function isUnder(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

/**
 * Why `target` belongs to the protected class that is refused rather than
 * redirected, or null when it is an ordinary path. Matches both directions:
 * the target itself (`rm -rf /etc`) and any ancestor of a protected root
 * (`rm -rf /home`).
 */
export function protectedTargetReason(target: string, home: string): string | null {
  if (target === home) {
    return `\`${target}\` is the home directory itself, which is never deleted or trashed. Delete a specific file or directory inside it instead.`;
  }
  // Root mode, exactly as `pre-bash` evaluates it for a system root: the root
  // itself, or any ancestor of it (`rm -rf /home` destroys every home under it).
  for (const root of SYSTEM_PROTECTED_ROOTS) {
    if (target !== root && !isUnder(root, target)) continue;
    return root === "/"
      ? `\`${target}\` is the filesystem root, which is never deleted.`
      : `\`${target}\` is the system root \`${root}\` (or an ancestor of it), which is never deleted or trashed.`;
  }
  for (const suffix of PROTECTED_HOME_TREES) {
    const root = join(home, suffix);
    // Tree mode, like `pre-bash`'s ~/.hasna rule: the store itself and
    // everything under it.
    if (!isUnder(target, root) && !isUnder(root, target)) continue;
    return `\`${target}\` is the protected \`~/${suffix}\` path (or contains it), which is never deleted or trashed. Delete a specific file inside it, and only when you are sure.`;
  }
  return null;
}

/**
 * Whether an `rm` belongs to the protected repo-checkout roots and must be
 * handed to `workspace-repos-guard`: any literal operand under a root, or a
 * command whose effective cwd sits under one (a relative operand there means
 * a path inside the guarded roots).
 */
function isHandoff(operands: Word[], cwd: string, home: string): boolean {
  const roots = handoffRoots(home);
  if (roots.some((root) => isUnder(cwd, root))) return true;
  for (const operand of operands) {
    const target = resolveLiteralTarget(operand.text, cwd, home);
    if (target && roots.some((root) => isUnder(target, root))) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Scan                                                                */
/* ------------------------------------------------------------------ */

interface ScanContext {
  cwd: string;
  home: string;
  /** Recursion depth for substitution bodies. */
  depth: number;
}

/**
 * Classify a command string: which `rm` verbs are ours to rewrite, which are
 * handed to the guarded-roots hook, and why anything else is refused.
 *
 * Only command position counts, and only `rm`'s own grammar is rewritten.
 */
export function scanCommand(command: string, options: { cwd: string; home: string; depth?: number }): ScanResult {
  const ctx: ScanContext = { cwd: options.cwd, home: options.home, depth: options.depth ?? 0 };
  const result: ScanResult = { rmHits: [], handoffHits: [], refusals: [], protectedHits: [], trustworthy: true };

  const lexed = lexCommand(command);
  result.trustworthy = lexed.trustworthy;

  if (!lexed.trustworthy) {
    return result;
  }

  let cwd = ctx.cwd;
  for (const segment of lexed.segments) {
    const index = commandWordIndex(segment);
    if (index < 0) continue;
    const verb = baseVerb(decodeWord(segment.words[index].text));

    if (verb === "cd") {
      const operand = segment.words[index + 1];
      if (operand) {
        const target = resolveLiteralTarget(operand.text, cwd, ctx.home);
        if (target) cwd = target;
        else cwd = ctx.cwd;
      }
      continue;
    }

    const refusal = REFUSED_VERBS[verb];
    if (refusal) {
      result.refusals.push({ reason: refusal });
      continue;
    }

    if (verb === "rm") {
      const operands = rmOperands(segment, index);
      // `rm` with no operand deletes nothing (GNU `rm` exits "missing
      // operand"), so `rm --help` and a bare `rm -rf` are not interceptable
      // deletes and are left exactly as written.
      if (operands.length === 0) continue;
      const hit: RmHit = { word: segment.words[index], operands };
      if (isHandoff(hit.operands, cwd, ctx.home)) {
        result.handoffHits.push(hit);
        continue;
      }
      result.rmHits.push(hit);
      for (const operand of hit.operands) {
        // An unresolvable operand (variable, glob, substitution) is not
        // classified here: the rewrite still applies, and `trash guard`
        // classifies the paths the shell actually expands to.
        const target = resolveLiteralTarget(operand.text, cwd, ctx.home);
        if (!target) continue;
        const reason = protectedTargetReason(target, ctx.home);
        if (reason) {
          result.protectedHits.push({ reason });
          break;
        }
      }
      continue;
    }

    if (APPLET_DISPATCHERS.has(verb)) {
      const appletIndex = segment.words.findIndex((word, at) => at > index && !decodeWord(word.text).startsWith("-"));
      const applet = appletIndex >= 0 ? baseVerb(decodeWord(segment.words[appletIndex].text)) : "";
      if (applet === "rm" || applet in REFUSED_VERBS) {
        result.refusals.push({
          reason: `\`${verb} ${applet}\` runs the ${verb} applet, whose own \`rm\` is not GNU \`rm\` and cannot be rewritten in place. Run the delete as \`rm -- <path>\`, which is redirected into trash.`,
        });
      }
      continue;
    }

    if (verb === "git") {
      const sub = gitSubcommand(segment, index);
      if (sub === "rm" || sub === "clean") {
        const dryOrIndexOnly = sub === "rm" ? gitRmIsNonDeleting(segment, index) : gitHasDryRun(segment, index);
        if (!dryOrIndexOnly) {
          result.refusals.push({
            reason:
              sub === "rm"
                ? "`git rm` is refused: without `--cached` it deletes the working-tree file, and its semantics are not `rm`'s. Use `rm -- <path>` (intercepted and redirected into trash) to remove the file, or `git rm --cached -- <path>` to unstage it without deleting."
                : "`git clean` deletes untracked files irrecoverably and is refused. Remove them explicitly with `rm -- <path>` (intercepted and redirected into trash), or preview with `git clean -n`.",
          });
        }
      }
      continue;
    }

    if (verb === "find") {
      const words = segment.words.map((word) => decodeWord(word.text));
      const deleteIndex = words.indexOf("-delete");
      if (deleteIndex >= 0) {
        result.refusals.push({
          reason:
            "`find -delete` deletes files irrecoverably and is refused. List the paths first (`find … -print`), then remove them explicitly with `rm -- <path>` so the delete is redirected into trash.",
        });
        continue;
      }
      const execIndex = words.findIndex((word) => word === "-exec" || word === "-execdir" || word === "-ok");
      if (execIndex >= 0 && words.slice(execIndex).some((word) => word === "rm" || word === "rmdir" || word === "unlink" || word === "shred")) {
        result.refusals.push({
          reason: "`find -exec <delete>` is refused: the delete runs through find, not through `rm`, and cannot be redirected into trash. Remove the paths explicitly with `rm -- <path>`.",
        });
        continue;
      }
      continue;
    }

    if (verb === "xargs" && segment.words.some((word) => decodeWord(word.text) === "rm")) {
      result.refusals.push({
        reason: "`xargs rm` takes its targets from stdin, so this hook cannot verify what would be deleted. Pipe the paths into an explicit `rm -- <path> …` instead, which is redirected into trash.",
      });
      continue;
    }

    if (OPAQUE_COMMANDS.has(verb) && mentionsDeleteVerb(segmentText(segment))) {
      result.refusals.push({
        reason: `\`${verb}\` runs a command string this hook cannot rewrite in place. Run the delete directly as \`rm -- <path>\` (intercepted and redirected into trash), or as a script that uses \`trash guard\` itself.`,
      });
      continue;
    }
  }

  // A delete hidden inside a command substitution runs before the rewritten
  // verb and cannot be swapped in place — refuse rather than rewrite a
  // command that still contains a live delete.
  if (ctx.depth < 3) {
    for (const body of lexed.substitutions) {
      const inner = scanCommand(body, { cwd, home: ctx.home, depth: ctx.depth + 1 });
      if (inner.rmHits.length > 0 || inner.refusals.length > 0 || inner.handoffHits.length > 0 || inner.protectedHits.length > 0) {
        result.refusals.push({
          reason: "This command runs a delete inside a command substitution `$(…)`, which this hook cannot rewrite. Run the delete as a separate `rm -- <path>` command, which is redirected into trash.",
        });
        break;
      }
    }
  } else if (lexed.substitutions.some((body) => mentionsDeleteVerb(body))) {
    result.refusals.push({
      reason: "This command nests a delete inside command substitutions deeper than this hook will follow. Run the delete as a separate `rm -- <path>` command.",
    });
  }

  return result;
}

function segmentText(segment: Segment): string {
  return segment.words.map((word) => word.text).join(" ");
}

/** The git subcommand, skipping git's own value-taking global options. */
function gitSubcommand(segment: Segment, verbIndex: number): string | null {
  let index = verbIndex + 1;
  while (index < segment.words.length) {
    const option = decodeWord(segment.words[index].text);
    if (!option.startsWith("-")) return option;
    index++;
    if (GIT_VALUE_OPTIONS.has(option)) index++;
  }
  return null;
}

/** `git rm` that does not remove a working-tree file: `--cached` or a dry run. */
function gitRmIsNonDeleting(segment: Segment, verbIndex: number): boolean {
  const options = segment.words.slice(verbIndex + 1).map((word) => decodeWord(word.text));
  if (options.includes("--cached")) return true;
  return gitHasDryRun(segment, verbIndex);
}

function gitHasDryRun(segment: Segment, verbIndex: number): boolean {
  const options = segment.words.slice(verbIndex + 1).map((word) => decodeWord(word.text));
  return options.includes("-n") || options.includes("--dry-run");
}

/* ------------------------------------------------------------------ */
/* Rewrite                                                             */
/* ------------------------------------------------------------------ */

/**
 * Locate the `trash` executable on PATH and return its absolute path, or null
 * when there is nothing to redirect to. Presence only — the guard decision
 * never waits on the binary, its store, or a network.
 */
export function findTrashBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const pathValue = env.PATH ?? "";
  for (const dir of pathValue.split(":")) {
    if (!dir) continue;
    // resolve(): a relative PATH entry still yields the absolute path the
    // rewrite must use, so the rewritten command never depends on PATH again.
    const candidate = resolve(dir, "trash");
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return candidate;
    } catch {
      // not there — keep looking
    }
  }
  return null;
}

function shellQuoteWord(word: string): string {
  if (/^[A-Za-z0-9_\-./+=:,@%^]+$/.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * Replace the verb token of every owned `rm` with `<quoted trash> guard`,
 * leaving every other byte of the command untouched.
 */
export function rewriteCommand(command: string, hits: RmHit[], trashPath: string): string {
  const replacement = `${shellQuoteWord(trashPath)} guard`;
  const ordered = [...hits].sort((a, b) => b.word.start - a.word.start);
  let out = command;
  for (const hit of ordered) {
    out = `${out.slice(0, hit.word.start)}${replacement}${out.slice(hit.word.end)}`;
  }
  return out;
}

/**
 * Re-read the rewritten command and prove it carries no command-position
 * delete verb. A rewrite that still leaves one is not a rewrite — the caller
 * denies instead of allowing it.
 */
export function rewriteIsComplete(original: string, rewritten: string, hits: RmHit[], cwd: string, home: string): boolean {
  if (!rewritten || rewritten === original) return false;
  if (hits.length === 0) return false;
  const verify = scanCommand(rewritten, { cwd, home });
  if (!verify.trustworthy) return false;
  if (verify.rmHits.length > 0 || verify.handoffHits.length > 0) return false;
  return verify.refusals.length === 0;
}

/**
 * Build the complete tool_input for the rewrite. The harness replaces the
 * whole input object, so every key the model supplied is preserved and the
 * Bash tool's own fields are re-supplied at their documented defaults when
 * absent.
 */
export function buildUpdatedInput(toolInput: Record<string, unknown> | undefined, command: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toolInput ?? {})) out[key] = value;

  out.command = command;

  if (typeof out.description !== "string" || out.description.trim() === "") {
    out.description = DEFAULT_DESCRIPTION;
  }
  if (typeof out.timeout !== "number" || !Number.isFinite(out.timeout) || out.timeout <= 0) {
    out.timeout = DEFAULT_TIMEOUT_MS;
  }
  if (typeof out.run_in_background !== "boolean") {
    out.run_in_background = false;
  }
  if ("dangerouslyDisableSandbox" in out && typeof out.dangerouslyDisableSandbox !== "boolean") {
    delete out.dangerouslyDisableSandbox;
  }
  return out;
}

/** A rewritten input is only allowed when it is complete and self-consistent. */
function updatedInputIsComplete(updated: Record<string, unknown>, original: string, hits: RmHit[], cwd: string, home: string): boolean {
  if (typeof updated.command !== "string" || updated.command.trim() === "") return false;
  if (typeof updated.description !== "string" || updated.description.trim() === "") return false;
  if (typeof updated.timeout !== "number" || !Number.isFinite(updated.timeout) || updated.timeout <= 0) return false;
  if (typeof updated.run_in_background !== "boolean") return false;
  if ("dangerouslyDisableSandbox" in updated && typeof updated.dangerouslyDisableSandbox !== "boolean") return false;
  return rewriteIsComplete(original, updated.command, hits, cwd, home);
}

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

export interface GuardDependencies {
  home: string;
  cwd: string;
  findTrash: (env?: NodeJS.ProcessEnv) => string | null;
}

function deny(reason: string): CodewithHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * The allow path is deliberately minimal — exactly the three fields the
 * harness consumes — so nothing else in the object can make it unparseable
 * and drop the hook back onto the original `rm`.
 */
function allowRewrite(updatedInput: Record<string, unknown>): CodewithHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput,
    },
  };
}

/**
 * Resolution is fail-closed: a lookup that throws is not "no binary found" but
 * a decision the guard cannot make, and it is reported as such rather than
 * falling through to the raw `rm`.
 */
function resolveTrash(deps: GuardDependencies): { path: string | null; error: string | null } {
  try {
    return { path: deps.findTrash(), error: null };
  } catch (cause) {
    return { path: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

const ABSENT_REASON =
  "[trash-guard] `trash` is not on PATH, so this `rm` cannot be redirected into a recoverable delete — and an unrecoverable delete is never allowed, so the command is refused rather than run. Install @hasna/trash (`npm install -g @hasna/trash`), which puts the binary on PATH, then re-run the same command: it is then rewritten to `trash guard` and the files land in trash instead of disappearing.";

export function evaluate(input: CodewithHookInput, deps: GuardDependencies): CodewithHookOutput {
  if (input.hook_event_name !== "PreToolUse") return { continue: true };
  if (input.tool_name !== "Bash") return { continue: true };

  // A command we cannot READ is a payload we cannot verify, and the harness
  // falls back to the ORIGINAL tool input whenever `updatedInput` is missing or
  // empty -- so "cannot tell" must never resolve to "run it". Refuse instead.
  // A command that is PRESENT and empty runs nothing, so that stays allowed.
  const rawCommand = (input as { tool_input?: { command?: unknown } }).tool_input?.command;
  if (typeof rawCommand !== "string") {
    return deny(
      "[trash-guard] The Bash tool call carried no readable `command`, so this hook cannot verify what would run. Refusing a call it cannot verify. Re-run the delete explicitly as `rm -- <path>` so it can be redirected into trash.",
    );
  }

  const command = getCommand(input);
  if (!command.trim()) return { continue: true };

  const scanned = scanCommand(command, { cwd: deps.cwd, home: deps.home });

  if (scanned.refusals.length > 0) {
    return deny(`[trash-guard] ${scanned.refusals[0].reason}`);
  }

  if (scanned.protectedHits.length > 0) {
    // The catastrophic class (§15 decision 11.3): refused on the spot, never
    // rewritten into a trashed delete.
    return deny(`[trash-guard] ${scanned.protectedHits[0].reason}`);
  }

  if (!scanned.trustworthy) {
    // The lexer could not follow this command to its end, so no rewrite of it
    // can be trusted. A delete-verb word means it might be a delete: refuse.
    return mentionsDeleteVerb(command)
      ? deny(
          "[trash-guard] This command could not be parsed to the end (unterminated quote, substitution or here-document), so a delete inside it cannot be redirected. Re-run the delete as a plain `rm -- <path>` command.",
        )
      : { continue: true };
  }

  if (scanned.rmHits.length === 0) {
    if (scanned.handoffHits.length > 0) {
      // Every delete here belongs to the guarded repo-checkout roots, which
      // `workspace-repos-guard` owns. Abstain and let that hook decide.
      return { continue: true };
    }
    return { continue: true };
  }

  if (scanned.handoffHits.length > 0) {
    return deny(
      "[trash-guard] This command mixes a delete under the protected repo-checkout roots (owned by workspace-repos-guard) with a delete outside them, and a partial rewrite would leave one of them unredirected. Re-run them as separate commands, so each delete is handled by the hook that owns it.",
    );
  }

  const trash = resolveTrash(deps);
  if (trash.error !== null) {
    return deny(
      `[trash-guard] The guard could not resolve the \`trash\` binary (${trash.error}), so this \`rm\` cannot be redirected into a recoverable delete — and an unrecoverable delete is never allowed, so the command is refused rather than run. Fix the environment (PATH, permissions) and re-run the same command.`,
    );
  }
  if (trash.path === null) {
    return deny(ABSENT_REASON);
  }
  const trashPath = trash.path;

  const rewritten = rewriteCommand(command, scanned.rmHits, trashPath);
  const updatedInput = buildUpdatedInput(input.tool_input, rewritten);

  if (!updatedInputIsComplete(updatedInput, command, scanned.rmHits, deps.cwd, deps.home)) {
    // Never allow a partial rewrite: the harness falls back to the ORIGINAL
    // tool input when `updatedInput` is missing or empty, which runs the raw
    // `rm`. Refuse instead.
    return deny(
      "[trash-guard] The rewrite of this command did not verify (the delete could not be redirected cleanly), so the command is refused rather than run unredirected. Re-run the delete as a plain `rm -- <path>` command.",
    );
  }

  return allowRewrite(updatedInput);
}

/** Verdict used when the hook itself fails: refuse anything that could delete. */
export function fallbackVerdict(command: string): CodewithHookOutput {
  return mentionsDeleteVerb(command)
    ? deny(
        "[trash-guard] The hook failed while classifying this command, so it cannot be proven free of an unredirected delete. Re-run the delete as a plain `rm -- <path>` command.",
      )
    : { continue: true };
}

export async function run(): Promise<void> {
  const input = readInput();
  const command = getCommand(input);
  try {
    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
    respond(evaluate(input, { home: homedir(), cwd, findTrash: findTrashBinary }));
  } catch (error) {
    warn(`${RULE} failed: ${error instanceof Error ? error.message : String(error)}`);
    respond(fallbackVerdict(command));
  }
}

if (import.meta.main) {
  await run();
  process.exit(0);
}
