/**
 * `capture.excludeGlobs` matching.
 *
 * This matcher is load-bearing, not cosmetic: §11.7 makes the exclude list the
 * boundary between "refuse the delete" and "the delete proceeds without a
 * capture". A path that matches an exclude glob is the *not-precious* class
 * (build output, dependency trees, caches) — the class whose delete must still
 * work when the disk is full, because otherwise the trash self-locks the
 * machine (§6 failure mode). Everything else is protected: if we cannot
 * capture it, we do not delete it.
 *
 * Supported grammar (the subset the default list uses):
 *   `**`     any run of characters, crossing a separator
 *   `**` + `/`   zero or more whole path segments (so the pattern for "any
 *                foo anywhere" also matches `/foo`)
 *   `/` + `**`   a trailing separator + any remainder — also matches the
 *                directory itself (the node_modules pattern matches the
 *                `…/node_modules` directory and everything under it)
 *   `*`      any run of characters inside one segment
 *   `?`      one character inside one segment
 *
 * A glob never matches a mere string prefix: `/a/dist2` does not match the
 * default dist pattern.
 *
 * (The grammar is written out this way — rather than as literal examples —
 * because a block comment may not contain the two characters that close it.)
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compile one glob to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const trimmed = glob.trim();
  if (trimmed.length === 0) throw new Error("glob: empty pattern");
  let out = "^";
  let i = 0;
  while (i < trimmed.length) {
    if (trimmed.startsWith("**", i)) {
      const next = trimmed[i + 2];
      if (next === "/") {
        out += "(?:.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
      continue;
    }
    const ch = trimmed[i]!;
    if (ch === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (ch === "/" && trimmed.startsWith("/**", i) && i + 3 === trimmed.length) {
      out += "(?:/.*)?";
      i += 3;
      continue;
    }
    out += escapeRegExp(ch);
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

/** Strip trailing separators — a trailing slash must never change a decision. */
export function normalizeForMatch(path: string): string {
  let out = path.trim();
  while (out.length > 1 && (out.endsWith("/") || out.endsWith("\\"))) {
    out = out.slice(0, -1);
  }
  return out;
}

export interface CompiledGlob {
  glob: string;
  re: RegExp;
}

export function compileGlobs(globs: readonly string[]): CompiledGlob[] {
  return globs.map((glob) => ({ glob, re: globToRegExp(glob) }));
}

/** True when `path` matches any glob in `globs`. */
export function isExcludedPath(path: string, globs: readonly string[]): boolean {
  if (globs.length === 0) return false;
  const candidate = normalizeForMatch(path);
  if (candidate.length === 0) return false;
  return compileGlobs(globs).some(({ re }) => re.test(candidate));
}

/** The first glob (in declaration order) that matches — the refusal record names it. */
export function firstMatchingGlob(path: string, globs: readonly string[]): string | null {
  const candidate = normalizeForMatch(path);
  if (candidate.length === 0) return null;
  for (const glob of globs) {
    if (globToRegExp(glob).test(candidate)) return glob;
  }
  return null;
}
