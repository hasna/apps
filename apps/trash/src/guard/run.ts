/**
 * The guard's executor — the rewrite target `trash guard ...`.
 *
 * A rewritten command runs this instead of `rm`, so its exit code and its
 * stderr ARE the user's `rm` experience. The contract below was MEASURED
 * against GNU coreutils 9.4 (`/usr/bin/rm`, `/usr/bin/rmdir`) with every
 * fixture under an asserted `mktemp -d` sandbox, never recalled from memory —
 * and the measurement corrected the version of this table that a first draft
 * would have written:
 *
 *   `rm -f` with no operands            -> 0, silent.
 *                                          The "ignore nonexistent files AND
 *                                          MISSING OPERANDS" clause is real.
 *   `rm` / `rm -i` with no operands     -> 1, "missing operand".
 *   `-f` then `-i`, no operands         -> 1: `-i` CLEARS the force state.
 *   `-i` then `-f`, no operands         -> 0.
 *     …so the two are LAST-ONE-WINS in argv order, and the missing-operand
 *     tolerance is keyed on a force bit that `-i` resets — not on `-f` merely
 *     being present somewhere in argv.
 *   missing path, with `-f`             -> 0, silent.
 *   missing path, without `-f`          -> 1, "cannot remove 'x': No such file
 *                                          or directory".
 *   `-i` + missing path                 -> 1, and NO prompt: the lstat happens
 *                                          before the prompt.
 *   directory without `-r`/`-d`         -> 1, "Is a directory" — `-f` does NOT
 *                                          suppress this.
 *   `-d` + non-empty directory          -> 1, "Directory not empty", no prompt.
 *   `-d` + a plain file                 -> 0, file removed (`-d` is only about
 *                                          directories).
 *   `-i`, answer "n" or EOF             -> 0, the file survives; declining is
 *                                          NOT a failure.
 *   `-I` (once) triggers                -> `n_files > 3 || recursive`. NOT
 *                                          "any directory": `rm -I somedir`
 *                                          does not prompt. It prompts
 *                                          "remove N argument[s][ recursively]? "
 *                                          and a decline aborts the WHOLE
 *                                          command with 0, all operands intact.
 *   `--interactive=never`               -> does NOT carry `-f`'s tolerances:
 *                                          "missing operand"/missing path are
 *                                          still errors.
 *   `-v`                                -> stdout: `removed 'x'` for a
 *                                          non-directory, `removed directory
 *                                          'x'` for a directory.
 *   `rmdir -v`                          -> STDOUT: `rmdir: removing directory,
 *                                          'x'`.
 *   `rmdir` on a file                   -> 1, "Not a directory".
 *
 * Divergences, all deliberate and all narrower than GNU:
 *
 *   1. `-v` under `-r` prints ONE line for the tree, not one per descendant.
 *      The capture is a single atomic unit (one rename, §4/§5), so there is no
 *      moment at which children are individually gone; printing them would
 *      claim deletions the store did not perform one at a time.
 *   2. `-i` under `-r` prompts once for the tree ("descend into directory
 *      'x'? ") instead of once per descendant, for the same reason. The exit
 *      code is unaffected: a decline leaves the tree untouched and returns 0.
 *   3. `--one-file-system` REFUSES (exit 2) when the tree actually crosses a
 *      device boundary, rather than deleting the same-device part and skipping
 *      the rest. Partial destruction of a subtree is exactly the outcome the
 *      guard exists to prevent; the path is left untouched instead.
 *   4. `rmdir -p` REFUSES (exit 2): it removes ancestors, each of which is a
 *      separate delete that must be evaluated on its own.
 *   5. `--no-preserve-root` is ACCEPTED AND DOES NOTHING. GNU deletes `/` when
 *      it is given; the guard denies the protected-root class on its own
 *      authority (§11.3), and a flag cannot waive a policy the caller is not
 *      the owner of. It is accepted rather than rejected so that a command
 *      carrying it still runs — it just runs into the denial, with the reason
 *      on stderr, instead of dying on an unknown option.
 *
 * Exit codes (the CLI's contract, shared with every other `trash` verb):
 *   0 done   1 an rm-class error (missing without -f, is-a-directory, …)
 *   2 REFUSED — a policy refusal: protected path, capture refusal (§11.7),
 *              or a verb/flag the guard will not reproduce.
 */

import { lstatSync, readdirSync, readSync, type Stats } from "node:fs";
import { isatty } from "node:tty";
import { resolve } from "node:path";
import type { TrashStore } from "../lib/store.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_REFUSED = 2;

export interface GuardIO {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface GuardRunOptions {
  /** The rm-style argv, exactly as it followed the program token. */
  argv: readonly string[];
  cwd: string;
  io: GuardIO;
  /** The capture engine. `--spool` has already been applied to it. */
  store: TrashStore;
  agent?: string;
  /**
   * §11.7's explicit override. Note this is NOT `rm -f`: `-f` must stay what
   * rm means by it, or every `rm -rf` would silently defeat the capture.
   */
  allowUncaptured?: boolean;
  /** Message prefix. Defaults to `rm`, or `rmdir` in rmdir mode. */
  progName?: string;
  /** rmdir grammar instead of rm grammar. */
  rmdir?: boolean;
  /** Answer a prompt. Injected by tests; defaults to reading stdin. */
  ask?: (question: string) => boolean;
  /** Reads from this fd when `ask` is not supplied. */
  stdinFd?: number;
}

export interface GuardRunResult {
  code: number;
  removed: number;
  refused: number;
  failed: number;
}

type Interactive = "never" | "once" | "always";

interface RmFlags {
  force: boolean;
  interactive: Interactive;
  verbose: boolean;
  dirMode: boolean;
  recursive: boolean;
  oneFileSystem: boolean;
  parents: boolean;
  ignoreFailOnNonEmpty: boolean;
  operands: string[];
}

interface ParseOk {
  ok: true;
  flags: RmFlags;
  help: boolean;
  version: boolean;
}

interface ParseError {
  ok: false;
  message: string;
  usage: boolean;
}

const RM_LONG: Record<string, string> = {
  "--force": "force",
  "--interactive": "interactive",
  "--one-file-system": "one-file-system",
  "--preserve-root": "preserve-root",
  "--no-preserve-root": "no-preserve-root",
  "--recursive": "recursive",
  "--dir": "dir",
  "--verbose": "verbose",
  "--help": "help",
  "--version": "version",
};

const RMDIR_LONG: Record<string, string> = {
  "--ignore-fail-on-non-empty": "ignore-fail-on-non-empty",
  "--parents": "parents",
  "--verbose": "verbose",
  "--help": "help",
  "--version": "version",
};

const RM_SHORT = new Set(["f", "i", "I", "r", "R", "d", "v"]);
const RMDIR_SHORT = new Set(["p", "v"]);

/**
 * getopt_long resolves an unambiguous prefix, so `--rec` works. Ambiguity
 * cannot arise with rm's tiny option set, but it is handled rather than
 * ignored so a future option cannot silently change an existing spelling.
 */
function resolveLong(name: string, table: Record<string, string>): { key?: string; ambiguous?: string[] } {
  if (table[name] !== undefined) return { key: table[name] };
  const candidates = Object.keys(table).filter((option) => option.startsWith(name));
  if (candidates.length === 1) return { key: table[candidates[0]!]! };
  if (candidates.length > 1) return { ambiguous: candidates };
  return {};
}

function parseInteractive(value: string | undefined): Interactive | null {
  switch (value) {
    case undefined:
    case "always":
    case "yes":
      return "always";
    case "once":
      return "once";
    case "never":
    case "no":
    case "none":
      return "never";
    default:
      return null;
  }
}

export function parseGuardArgs(argv: readonly string[], rmdirMode: boolean): ParseOk | ParseError {
  const flags: RmFlags = {
    force: false,
    interactive: "never",
    verbose: false,
    dirMode: false,
    recursive: false,
    oneFileSystem: false,
    parents: false,
    ignoreFailOnNonEmpty: false,
    operands: [],
  };
  const shortSet = rmdirMode ? RMDIR_SHORT : RM_SHORT;
  const longTable = rmdirMode ? RMDIR_LONG : RM_LONG;
  let help = false;
  let version = false;
  let noMoreOptions = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    if (noMoreOptions || arg === "-" || !arg.startsWith("-")) {
      flags.operands.push(arg);
      continue;
    }

    if (arg === "--") {
      noMoreOptions = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      const resolved = resolveLong(name, longTable);
      if (resolved.ambiguous) {
        return {
          ok: false,
          message: `option '${name}' is ambiguous; possibilities: ${resolved.ambiguous.map((c) => `'${c}'`).join(" ")}`,
          usage: true,
        };
      }
      if (resolved.key === undefined) {
        return { ok: false, message: `unrecognized option '${name}'`, usage: true };
      }
      switch (resolved.key) {
        case "force":
          flags.force = true;
          flags.interactive = "never";
          break;
        case "interactive": {
          const when = parseInteractive(inline);
          if (when === null) {
            return { ok: false, message: `invalid argument '${inline ?? ""}' for '--interactive'`, usage: true };
          }
          flags.interactive = when;
          // Measured: `--interactive=never` is NOT `-f` — it leaves the
          // missing-operand and missing-file tolerances off.
          if (when !== "never") flags.force = false;
          break;
        }
        case "recursive":
          flags.recursive = true;
          break;
        case "dir":
          flags.dirMode = true;
          break;
        case "verbose":
          flags.verbose = true;
          break;
        case "one-file-system":
          flags.oneFileSystem = true;
          break;
        case "parents":
          flags.parents = true;
          break;
        case "ignore-fail-on-non-empty":
          flags.ignoreFailOnNonEmpty = true;
          break;
        case "preserve-root":
        case "no-preserve-root":
          // Accepted and ignored. The guard denies the protected-root class on
          // its own authority (§11.3); `--no-preserve-root` cannot waive it,
          // and `--preserve-root` is already the guard's behaviour.
          break;
        case "help":
          help = true;
          break;
        case "version":
          version = true;
          break;
        default:
          break;
      }
      continue;
    }

    // A short cluster: every character is an option, and they apply in order
    // (`-fi` is f-then-i, which is why `-fi` prompts and `-if` does not).
    for (const ch of arg.slice(1)) {
      if (!shortSet.has(ch)) {
        return { ok: false, message: `invalid option -- '${ch}'`, usage: true };
      }
      switch (ch) {
        case "f":
          flags.force = true;
          flags.interactive = "never";
          break;
        case "i":
          flags.interactive = "always";
          flags.force = false;
          break;
        case "I":
          flags.interactive = "once";
          flags.force = false;
          break;
        case "r":
        case "R":
          flags.recursive = true;
          break;
        case "d":
          flags.dirMode = true;
          break;
        case "v":
          flags.verbose = true;
          break;
        case "p":
          flags.parents = true;
          break;
        default:
          break;
      }
    }
  }

  return { ok: true, flags, help, version };
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function isEmptyDirectory(path: string): boolean {
  try {
    return readdirSync(path).length === 0;
  } catch {
    // Unreadable is not empty; the capture will report the real reason.
    return false;
  }
}

/**
 * The first descendant that lives on a different device, or `null`. Only
 * consulted for `--one-file-system`; a tree that stays on one device is
 * unaffected by the flag and proceeds normally.
 */
function firstCrossDeviceEntry(root: string, device: number): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const child = `${current}/${name}`;
      const info = lstatOrNull(child);
      if (info === null) continue;
      if (info.dev !== device) return child;
      if (info.isDirectory() && !info.isSymbolicLink()) stack.push(child);
    }
  }
  return null;
}

/** The type word GNU puts in the prompt, e.g. "write-protected regular empty file". */
function promptType(info: Stats): string {
  if (info.isDirectory()) return "directory";
  if (info.isSymbolicLink()) return "symbolic link";
  if (info.isFIFO()) return "fifo";
  if (info.isSocket()) return "socket";
  if (info.isBlockDevice()) return "block special file";
  if (info.isCharacterDevice()) return "character special file";
  const empty = info.size === 0 ? " empty" : "";
  const protectedPrefix = (info.mode & 0o200) === 0 ? "write-protected " : "";
  return `${protectedPrefix}regular${empty} file`;
}

/**
 * A line-oriented reader over stdin.
 *
 * Not a TTY: stdin is read to EOF up front and served line by line, so a
 * redirect like `rm -i x < answers.txt` behaves exactly as it does under rm.
 * A TTY: one byte at a time until a newline, so an interactive prompt returns
 * as soon as the user presses Enter rather than waiting for a Ctrl-D.
 *
 * EOF is "no" (§15 correction): the file is preserved, the command moves on,
 * and the exit code stays 0 — declining is not a failure.
 */
export function stdinAnswerer(fd: number = 0): () => string | null {
  let lines: string[] | null = null;
  let offset = 0;

  return () => {
    if (lines === null && !isatty(fd)) {
      try {
        const buffer = Buffer.alloc(4096);
        const chunks: Buffer[] = [];
        for (;;) {
          const read = readSync(fd, buffer, 0, buffer.length, null);
          if (read <= 0) break;
          chunks.push(Buffer.from(buffer.subarray(0, read)));
        }
        lines = Buffer.concat(chunks).toString("utf8").split("\n");
      } catch {
        lines = [];
      }
    }
    if (lines !== null) {
      if (offset >= lines.length) return null;
      const line = lines[offset]!;
      offset += 1;
      return line;
    }
    // A TTY: accumulate until the user presses Enter.
    let line = "";
    const byte = Buffer.alloc(1);
    for (;;) {
      let read = 0;
      try {
        read = readSync(fd, byte, 0, 1, null);
      } catch {
        return line.length > 0 ? line : null;
      }
      if (read <= 0) return line.length > 0 ? line : null;
      const ch = byte.toString("utf8");
      if (ch === "\n") return line;
      line += ch;
    }
  };
}

function makeAsker(options: GuardRunOptions, io: GuardIO): (question: string) => boolean {
  if (options.ask) return options.ask;
  const nextLine = stdinAnswerer(options.stdinFd ?? 0);
  return (question: string) => {
    io.stderr(question);
    const line = nextLine();
    if (line === null) return false;
    return /^[yY]/.test(line);
  };
}

/**
 * Run one intercepted delete command. Returns the exit code the user's shell
 * must see, plus counts a caller can log.
 */
export function runGuard(options: GuardRunOptions): GuardRunResult {
  const io = options.io;
  const parsed = parseGuardArgs(options.argv, options.rmdir === true);
  const prog = options.progName ?? (options.rmdir === true ? "rmdir" : "rm");

  if (!parsed.ok) {
    io.stderr(`${prog}: ${parsed.message}\n`);
    if (parsed.usage) io.stderr(`Try '${prog} --help' for more information.\n`);
    return { code: EXIT_ERROR, removed: 0, refused: 0, failed: 1 };
  }

  const { flags } = parsed;
  if (parsed.help) {
    io.stdout(options.rmdir === true ? RMDIR_HELP : RM_HELP);
    return { code: EXIT_OK, removed: 0, refused: 0, failed: 0 };
  }
  if (parsed.version) {
    io.stdout(`${prog} (trash guard) ${GUARD_VERSION}\n`);
    return { code: EXIT_OK, removed: 0, refused: 0, failed: 0 };
  }

  const missingOperand = (): GuardRunResult => {
    io.stderr(`${prog}: missing operand\n`);
    io.stderr(`Try '${prog} --help' for more information.\n`);
    return { code: EXIT_ERROR, removed: 0, refused: 0, failed: 1 };
  };

  if (flags.operands.length === 0) {
    // The measured oddity a first draft gets wrong: `-f` makes a MISSING
    // OPERAND legal too, and `-i` takes that away again.
    if (!flags.force) return missingOperand();
    return { code: EXIT_OK, removed: 0, refused: 0, failed: 0 };
  }

  const ask = makeAsker(options, io);
  let removed = 0;
  let refused = 0;
  let failed = 0;
  let verboseLines: string[] = [];

  // `-I` is a single pre-pass over the operand list, not a per-file prompt.
  let interactive: Interactive = flags.interactive;
  if (interactive === "once") {
    if (flags.recursive || flags.operands.length > 3) {
      const count = flags.operands.length;
      const plural = count === 1 ? "" : "s";
      const recursively = flags.recursive ? " recursively" : "";
      if (!ask(`${prog}: remove ${count} argument${plural}${recursively}? `)) {
        // A decline aborts the ENTIRE command: measured rc 0, every operand
        // still present.
        return { code: EXIT_OK, removed: 0, refused: 0, failed: 0 };
      }
      interactive = "never";
    } else {
      interactive = "never";
    }
  }

  for (const operand of flags.operands) {
    const absolute = operand.length === 0 ? null : resolve(options.cwd, operand);

    if (options.rmdir === true && flags.parents) {
      io.stderr(
        `${prog}: refusing '${operand}': \`rmdir -p\` removes ancestors as well, and each of those is a delete the guard must evaluate on its own. Remove them one at a time.\n`,
      );
      refused += 1;
      continue;
    }

    const info = absolute === null ? null : lstatOrNull(absolute);
    if (info === null) {
      // Measured: the existence check comes BEFORE the prompt, so `rm -i
      // missing` prints no prompt at all.
      if (flags.force && options.rmdir !== true) continue;
      if (options.rmdir === true) {
        io.stderr(`${prog}: failed to remove '${operand}': No such file or directory\n`);
      } else {
        io.stderr(`${prog}: cannot remove '${operand}': No such file or directory\n`);
      }
      failed += 1;
      continue;
    }

    if (options.rmdir === true) {
      if (!info.isDirectory()) {
        const reason = info.isSymbolicLink() ? "Symbolic link not followed" : "Not a directory";
        io.stderr(`${prog}: failed to remove '${operand}': ${reason}\n`);
        failed += 1;
        continue;
      }
      if (!isEmptyDirectory(absolute!)) {
        if (flags.ignoreFailOnNonEmpty) continue;
        io.stderr(`${prog}: failed to remove '${operand}': Directory not empty\n`);
        failed += 1;
        continue;
      }
      if (interactive === "always" && !ask(`${prog}: remove directory '${operand}'? `)) continue;
      const outcome = capture(options, absolute!, operand);
      if (outcome === "refused") {
        refused += 1;
        continue;
      }
      if (outcome === "failed") {
        failed += 1;
        continue;
      }
      removed += 1;
      if (flags.verbose) verboseLines.push(`${prog}: removing directory, '${operand}'`);
      continue;
    }

    // ---- rm grammar -------------------------------------------------------
    const isDir = info.isDirectory();
    if (isDir && !flags.recursive && !flags.dirMode) {
      io.stderr(`${prog}: cannot remove '${operand}': Is a directory\n`);
      failed += 1;
      continue;
    }
    if (isDir && !flags.recursive && flags.dirMode && !isEmptyDirectory(absolute!)) {
      io.stderr(`${prog}: cannot remove '${operand}': Directory not empty\n`);
      failed += 1;
      continue;
    }
    if (flags.oneFileSystem && isDir) {
      const crossing = firstCrossDeviceEntry(absolute!, info.dev);
      if (crossing !== null) {
        io.stderr(
          `${prog}: refusing '${operand}': --one-file-system was requested and ${crossing} is on a different device. The guard will not delete part of a tree and leave the rest, so nothing was removed.\n`,
        );
        refused += 1;
        continue;
      }
    }

    if (interactive === "always") {
      // GNU prompts "descend into directory 'x'?" for a directory under -r and
      // "remove <type> 'x'?" otherwise. The guard prompts ONCE for the tree
      // (the capture is one atomic unit) — see the divergence note above.
      const question = isDir
        ? `${prog}: descend into directory '${operand}'? `
        : `${prog}: remove ${promptType(info)} '${operand}'? `;
      if (!ask(question)) continue;
    }

    const outcome = capture(options, absolute!, operand);
    if (outcome === "refused") {
      refused += 1;
      continue;
    }
    if (outcome === "failed") {
      failed += 1;
      continue;
    }
    removed += 1;
    if (flags.verbose) {
      verboseLines.push(isDir ? `removed directory '${operand}'` : `removed '${operand}'`);
    }
  }

  // stdout is written once, at the end: nothing the guard prints can interleave
  // with a prompt on stderr, and a refused delete never gets a "removed" line.
  for (const line of verboseLines) io.stdout(`${line}\n`);

  const code = refused > 0 ? EXIT_REFUSED : failed > 0 ? EXIT_ERROR : EXIT_OK;
  return { code, removed, refused, failed };
}

/**
 * Hand one target to the capture engine and translate its outcome.
 *
 * `missing` is returned as a failure here only in the guard's own sense; the
 * caller decides the exit code, because `rm -f` treats a vanished path as
 * success while `rm -i` treats it as an error — the same fact, two contracts.
 */
function capture(options: GuardRunOptions, absolute: string, operand: string): "captured" | "failed" | "refused" {
  const io = options.io;
  const prog = options.progName ?? (options.rmdir === true ? "rmdir" : "rm");
  const record = options.agent === undefined ? {} : { agent: options.agent };
  const outcome = options.store.put(absolute, { cwd: options.cwd, ...record })[0];
  if (!outcome) {
    io.stderr(`trash guard: capture of '${operand}' produced no outcome; nothing was deleted\n`);
    return "failed";
  }

  switch (outcome.status) {
    case "captured":
    case "deleted_without_capture":
      return "captured";
    case "missing":
      if (options.rmdir === true) {
        io.stderr(`${prog}: failed to remove '${operand}': No such file or directory\n`);
      } else {
        io.stderr(`${prog}: cannot remove '${operand}': No such file or directory\n`);
      }
      return "failed";
    case "refused": {
      if (options.allowUncaptured === true) {
        const forced = options.store.put(absolute, { cwd: options.cwd, force: true, ...record })[0];
        if (forced && (forced.status === "deleted_without_capture" || forced.status === "captured")) {
          return "captured";
        }
        io.stderr(
          `trash guard: '${operand}' is protected even from --allow-uncaptured (${forced?.detail ?? "no outcome"})\n`,
        );
        return "refused";
      }
      // §11.3 before §11.7: a protected path is refused on the guard's own
      // authority, and NO flag lifts it — the store refuses it again even
      // under `--allow-uncaptured` (probed: `trash guard -rf /tmp` refuses
      // whichever way it is invoked). So it must not be handed the §11.7
      // remedy, or the exit-2 message becomes an instruction that leads
      // straight back to the same refusal.
      if (outcome.refusals.some((refusal) => refusal.reason === "protected_path")) {
        io.stderr(`${prog}: cannot remove '${operand}': protected path (${outcome.detail})\n`);
        io.stderr(
          `trash guard: '${operand}' is in the protected class and no flag overrides it. Remove it by hand if that is truly what you mean.\n`,
        );
        return "refused";
      }
      // §11.7: a capture refusal refuses the DELETE. The path is untouched.
      io.stderr(`${prog}: cannot remove '${operand}': capture refused (${outcome.detail})\n`);
      io.stderr(
        `trash guard: '${operand}' was NOT deleted. Re-run with --allow-uncaptured to delete it anyway, or add it to capture.excludeGlobs.\n`,
      );
      return "refused";
    }
    default:
      return "failed";
  }
}

const GUARD_VERSION = "0.0.0";

const RM_HELP = `Usage: rm [OPTION]... [FILE]...
Remove (unlink) the FILE(s) — through the trash guard, so a delete is
recoverable unless the path is explicitly excluded from capture.

  -f, --force           ignore nonexistent files and arguments, never prompt
  -i                    prompt before every removal
  -I                    prompt once before removing more than three files, or
                          when removing recursively
      --interactive[=WHEN]  never, once (-I), or always (-i)
      --one-file-system  refuse a tree that crosses a device boundary
  -r, -R, --recursive   remove directories and their contents recursively
  -d, --dir             remove empty directories
  -v, --verbose         explain what is being done

guard flags (not rm's)
      --allow-uncaptured    delete even when the capture is refused (§11.7).
                            \`-f\` does NOT mean this.
      --rmdir               rmdir grammar
      --spool <dir>         the trash store this guard writes to
      --plan                print the rewrite decision as JSON and exit
      --agent <name>        recorded on captures and refusals

exit codes  0 done   1 rm error   2 refused (protected path, or a capture
            that was refused — the path is untouched)
`;

const RMDIR_HELP = `Usage: rmdir [OPTION]... DIRECTORY...
Remove the DIRECTORY(ies), if they are empty — through the trash guard.

      --ignore-fail-on-non-empty   ignore a non-empty directory
  -v, --verbose         output a diagnostic for every directory processed

guard flags (not rmdir's)
      --spool <dir>         the trash store this guard writes to
      --agent <name>        recorded on captures and refusals

\`rmdir -p\` is refused (exit 2): it removes ancestors, and each of those is a
delete the guard must evaluate on its own.

exit codes  0 done   1 rmdir error   2 refused
`;

export { EXIT_ERROR, EXIT_OK, EXIT_REFUSED, GUARD_VERSION };
