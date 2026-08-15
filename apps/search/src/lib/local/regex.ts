/**
 * Regex search over the local index, Cursor/codesearch style: required literal
 * substrings are extracted from the pattern and used as a trigram FTS prefilter,
 * then the real RegExp runs only on the candidate files. The index layer may
 * produce false positives; verification against actual text is authoritative.
 */

interface BranchLiterals {
  /** Literals that must all appear for this alternation branch to match. */
  literals: string[];
}

/**
 * Extract required literals from a regex pattern, as an OR-of-ANDs across
 * top-level alternation branches. Conservative: any construct we don't fully
 * understand simply breaks the current literal run (weaker prefilter, never
 * wrong). Returns null when any branch lacks a literal of >= 3 chars, since
 * the index could not narrow candidates for that branch.
 */
export function extractRegexLiterals(pattern: string): BranchLiterals[] | null {
  const branches = splitTopLevelAlternation(pattern);
  const result: BranchLiterals[] = [];

  for (const branch of branches) {
    const literals = extractSequenceLiterals(branch).filter((l) => l.length >= 3);
    if (literals.length === 0) return null;
    result.push({ literals });
  }

  return result;
}

function splitTopLevelAlternation(pattern: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = "";

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      current += ch + (pattern[i + 1] ?? "");
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      current += ch;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      current += ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "|" && depth === 0) {
      branches.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  branches.push(current);
  return branches;
}

function extractSequenceLiterals(seq: string): string[] {
  const literals: string[] = [];
  let run = "";

  const flush = () => {
    if (run.length > 0) literals.push(run.toLowerCase());
    run = "";
  };

  let i = 0;
  while (i < seq.length) {
    const ch = seq[i]!;

    if (ch === "\\") {
      const next = seq[i + 1];
      if (next === undefined) break;
      if (/[a-zA-Z0-9]/.test(next)) {
        // Escape token (\w \d \t \n \x41 A \cX \k<name> \p{..}, backrefs):
        // never literal text. Consume the whole token — over-consuming only
        // weakens the prefilter (safe); a wrong required literal is not.
        flush();
        let len = 2;
        if (next === "x") {
          len = 4; // \xHH
        } else if (next === "u") {
          if (seq[i + 2] === "{") {
            const close = seq.indexOf("}", i + 2);
            len = close === -1 ? 2 : close - i + 1; // \u{...}
          } else {
            len = 6; // \uHHHH
          }
        } else if (next === "c") {
          len = 3; // \cX
        } else if (next === "k" && seq[i + 2] === "<") {
          const close = seq.indexOf(">", i + 2);
          len = close === -1 ? 2 : close - i + 1; // \k<name>
        } else if ((next === "p" || next === "P") && seq[i + 2] === "{") {
          const close = seq.indexOf("}", i + 2);
          len = close === -1 ? 2 : close - i + 1; // \p{...}
        }
        i += len;
        continue;
      }
      // Escaped metacharacter (\. \* \\ ...) — literal; quantifier may follow.
      const q = quantifierAt(seq, i + 2);
      if (q.optional) {
        flush();
      } else {
        run += next;
        if (q.repeats) flush();
      }
      i += 2 + q.length;
      continue;
    }

    if (ch === "(") {
      const end = findGroupEnd(seq, i);
      const inner = seq.slice(i + 1, end);
      const q = quantifierAt(seq, end + 1);
      flush();
      // Lookarounds and other (?...) specials contribute nothing (a negative
      // lookahead's literals must NOT be required). Optional groups likewise.
      const isSpecial = inner.startsWith("?") && !inner.startsWith("?:") && !inner.startsWith("?<");
      const isNamed = inner.startsWith("?<") && !inner.startsWith("?<=") && !inner.startsWith("?<!");
      const body = inner.startsWith("?:") ? inner.slice(2) : isNamed ? inner.replace(/^\?<[^>]*>/, "") : inner;
      if (!isSpecial && !q.optional && !inner.startsWith("?<=") && !inner.startsWith("?<!")) {
        const groupBranches = splitTopLevelAlternation(body);
        if (groupBranches.length === 1) {
          literals.push(...extractSequenceLiterals(body).filter((l) => l.length >= 3));
        }
        // Alternation inside a group: skipped (only common literals would be
        // required; extracting them is not worth the complexity).
      }
      i = end + 1 + q.length;
      continue;
    }

    if (ch === "[") {
      const end = findClassEnd(seq, i);
      const q = quantifierAt(seq, end + 1);
      flush();
      i = end + 1 + q.length;
      continue;
    }

    if (ch === "." || ch === "^" || ch === "$") {
      flush();
      i++;
      continue;
    }

    if (ch === "*" || ch === "?" || ch === "+" || ch === "{") {
      // Quantifier with no tracked atom (e.g. after a group we already
      // handled): just skip it.
      const q = quantifierAt(seq, i);
      i += Math.max(1, q.length);
      continue;
    }

    // Plain literal char — check what follows.
    const q = quantifierAt(seq, i + 1);
    if (q.optional) {
      flush();
    } else {
      run += ch;
      if (q.repeats) flush();
    }
    i += 1 + q.length;
  }

  flush();
  return literals;
}

function quantifierAt(
  seq: string,
  pos: number,
): { length: number; optional: boolean; repeats: boolean } {
  const ch = seq[pos];
  if (ch === "?") return { length: 1, optional: true, repeats: false };
  if (ch === "*") return { length: 1, optional: true, repeats: true };
  if (ch === "+") return { length: 1, optional: false, repeats: true };
  if (ch === "{") {
    const end = seq.indexOf("}", pos);
    if (end === -1) return { length: 0, optional: false, repeats: false };
    const body = seq.slice(pos + 1, end);
    const min = parseInt(body, 10);
    const lazy = seq[end + 1] === "?" ? 1 : 0;
    return { length: end - pos + 1 + lazy, optional: !(min >= 1), repeats: true };
  }
  // Lazy modifier on its own shouldn't appear here; treat as no quantifier.
  return { length: 0, optional: false, repeats: false };
}

function findGroupEnd(seq: string, start: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = start; i < seq.length; i++) {
    const ch = seq[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return seq.length - 1;
}

function findClassEnd(seq: string, start: number): number {
  for (let i = start + 1; i < seq.length; i++) {
    const ch = seq[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "]" && i > start + 1) return i;
  }
  return seq.length - 1;
}

/**
 * Build an FTS5 MATCH expression prefiltering candidates for a regex, or null
 * when the pattern has no required literals long enough for the trigram index.
 */
export function buildFtsQueryFromRegex(pattern: string): string | null {
  const branches = extractRegexLiterals(pattern);
  if (!branches) return null;

  const branchExprs = branches.map((b) => {
    const ands = b.literals
      .map((l) => l.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""))
      .filter((l) => l.length >= 3)
      .map((l) => `"${l.replace(/"/g, '""')}"`)
      .join(" AND ");
    return branches.length > 1 ? `(${ands})` : ands;
  });

  if (branchExprs.some((e) => e.length === 0)) return null;

  return branchExprs.join(" OR ");
}

export function compileSearchRegex(pattern: string, caseSensitive = false): RegExp {
  return new RegExp(pattern, caseSensitive ? "" : "i");
}
