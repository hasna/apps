/**
 * Gitignore-style pattern matching for the local file indexer.
 *
 * Semantics follow git: last matching pattern wins, `!` negates, trailing `/`
 * matches directories only, patterns containing a non-trailing `/` are anchored
 * to the directory holding the ignore file, bare patterns match basenames at
 * any depth. Re-including files under an ignored directory is not supported
 * (same as git: the walker never descends into ignored directories).
 */

interface CompiledPattern {
  regex: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

/** Find the closing `]` of a character class, honoring `\]` and a leading `]`/`!]`. */
function classEnd(pattern: string, open: number): number {
  let i = open + 1;
  if (pattern[i] === "!") i++;
  if (pattern[i] === "]") i++; // leading `]` is a literal member
  for (; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
      continue;
    }
    if (pattern[i] === "]") return i;
  }
  return -1;
}

function globToRegExp(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // Git semantics: `**` only crosses directories when it forms a whole
        // path segment (`**/`, `/**`, or bare `**`); otherwise it's just `*`.
        const segmentStart = i === 0 || pattern[i - 1] === "/";
        if (segmentStart && pattern[i + 2] === "/") {
          out += "(?:[^/]*/)*";
          i += 3;
        } else if (segmentStart && i + 2 === pattern.length) {
          out += ".*";
          i += 2;
        } else {
          out += "[^/]*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if (ch === "[") {
      const close = classEnd(pattern, i);
      if (close === -1) {
        out += "\\[";
        i += 1;
      } else {
        let cls = pattern.slice(i + 1, close);
        if (cls.startsWith("!")) cls = "^" + cls.slice(1);
        // Re-escape for a JS class: keep existing escapes, escape bare ] and \.
        let jsCls = "";
        for (let k = 0; k < cls.length; k++) {
          const c = cls[k]!;
          if (c === "\\" && k + 1 < cls.length) {
            jsCls += "\\" + cls[k + 1];
            k++;
          } else if (c === "]") {
            jsCls += "\\]";
          } else if (c === "\\") {
            jsCls += "\\\\";
          } else {
            jsCls += c;
          }
        }
        out += `[${jsCls}]`;
        i = close + 1;
      }
    } else if (ch === "\\" && i + 1 < pattern.length) {
      out += pattern[i + 1]!.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
      i += 2;
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return out;
}

function compile(raw: string): CompiledPattern | null {
  let pattern = raw.replace(/\r$/, "");
  if (!pattern.trim() || pattern.startsWith("#")) return null;

  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1);
  }

  // Trailing spaces are ignored unless escaped.
  pattern = pattern.replace(/(?<!\\) +$/, "");
  if (!pattern) return null;

  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  // A pattern with a slash (after stripping the trailing one) is anchored to
  // the ignore file's directory; a bare pattern matches at any depth.
  const anchored = pattern.includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);

  const body = globToRegExp(pattern);
  const prefix = anchored ? "^" : "^(?:.*/)?";
  const regex = new RegExp(`${prefix}${body}$`);
  return { regex, negated, dirOnly };
}

export class IgnoreMatcher {
  private patterns: CompiledPattern[];
  /** Directory the ignore file lives in, relative to the walk root ("" = root). */
  readonly base: string;

  constructor(lines: string[], base = "") {
    this.base = base;
    this.patterns = lines
      .map(compile)
      .filter((p): p is CompiledPattern => p !== null);
  }

  /**
   * Returns true/false if a pattern matched (last match wins), or undefined
   * if no pattern in this matcher applies to the path.
   */
  ignores(relPath: string, isDir: boolean): boolean | undefined {
    // Paths are relative to the walk root; trim to this matcher's base dir.
    let local = relPath;
    if (this.base) {
      if (!relPath.startsWith(this.base + "/")) return undefined;
      local = relPath.slice(this.base.length + 1);
    }

    let result: boolean | undefined;
    for (const p of this.patterns) {
      if (p.dirOnly && !isDir) continue;
      if (p.regex.test(local)) result = !p.negated;
    }
    return result;
  }
}

/**
 * Stack of ignore matchers built up as the walker descends. The `hard`
 * matcher (DEFAULT_EXCLUDES + per-root excludes) is consulted first and its
 * verdict is final — a `.gitignore` inside the tree must never be able to
 * re-include `.git/` or `node_modules/` via negation. Within the soft layer
 * (nested .gitignore files), deeper matchers take precedence.
 */
export class IgnoreStack {
  private hard: IgnoreMatcher[];
  private stack: IgnoreMatcher[] = [];

  constructor(hard: IgnoreMatcher | IgnoreMatcher[] | null = null) {
    this.hard = hard ? (Array.isArray(hard) ? hard : [hard]) : [];
  }

  push(matcher: IgnoreMatcher): void {
    this.stack.push(matcher);
  }

  pop(): void {
    this.stack.pop();
  }

  ignores(relPath: string, isDir: boolean): boolean {
    for (const matcher of this.hard) {
      const hardResult = matcher.ignores(relPath, isDir);
      if (hardResult !== undefined) return hardResult;
    }

    // Deepest soft matcher with an opinion wins.
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const result = this.stack[i]!.ignores(relPath, isDir);
      if (result !== undefined) return result;
    }
    return false;
  }
}

/** Directories and files that are never worth indexing, regardless of .gitignore. */
export const DEFAULT_EXCLUDES = [
  ".git/",
  ".hg/",
  ".svn/",
  "node_modules/",
  "__pycache__/",
  ".venv/",
  "venv/",
  ".tox/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".cache/",
  ".turbo/",
  ".parcel-cache/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  "target/",
  "coverage/",
  ".pnpm-store/",
  ".bun/",
  ".npm/",
  ".yarn/cache/",
  ".ssh/",
  ".aws/",
  ".azure/",
  ".gnupg/",
  ".gpg/",
  ".password-store/",
  ".kube/",
  ".docker/",
  ".codewith/logs/",
  ".codewith/logs_*.sqlite",
  ".codewith/**/*.sqlite",
  ".codewith/**/*.sqlite-*",
  ".codewith/**/*.db",
  ".codewith/**/*.db-*",
  "*.sqlite-wal",
  "*.sqlite-shm",
  "*.db-wal",
  "*.db-shm",
  "*.env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  ".DS_Store",
];
