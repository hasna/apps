#!/usr/bin/env bun

/**
 * PreToolUse hook: workspace-repos-guard
 *
 * Guards the protected repo-checkout roots. During the migration window BOTH
 * of these roots are protected: the canonical clones root
 * $HOME/.hasna/repos/clones (knowledge k_mssu9jdq_dgnnu2) and the legacy root
 * $HOME/workspace/repos. Each contains ONLY GitHub-org folders, and checkouts
 * at <root>/<org>/<repo>/ are read/context only. The legacy root stays guarded
 * until ~/workspace/repos is decommissioned fleet-wide.
 *
 * Structure-only guard — it deliberately does NOT duplicate the worktree-guard
 * hook, which owns edits-in-shared-checkouts semantics.
 *
 * BLOCKS:
 *   - any write to either protected root itself (file tools and Bash),
 *   - any write that would create a top-level entry under either root
 *     (depth <= 1),
 *   - any write whose second path segment is not an allowed GitHub org,
 *   - any delete (rm, rmdir, git clean, git rm, unlink, shred, trash, ...)
 *     anywhere under either protected root, at any depth.
 *
 * ALLOWS (structure only):
 *   - reads, always,
 *   - writes deeper inside an allowed org folder
 *     (clones/<org>/<repo>/... or workspace/repos/<org>/<repo>/...).
 *
 * Home spellings (~, $HOME, ${HOME}, including quoted forms) are expanded
 * before classification in Bash targets, file-tool paths, cd operands and
 * apply_patch file markers. Bash relative operands (`.`, `..`, bare names)
 * are resolved against the command's cwd when it sits under the repos root,
 * and against an explicit `cd` into the root when one is present. apply_patch
 * tools are inspected through their `*** Add File:` / `*** Update File:` /
 * `*** Delete File:` markers. Parenthesized command groups are unwrapped.
 *
 * Allowed orgs default to hasna,hasnaxyz,hasna-products and are overridable
 * with the WORKSPACE_REPOS_GUARD_ORGS env var (comma-separated). Private
 * workspace orgs must be added per-install via that var; they are never part
 * of the public default.
 * Home is resolved with os.homedir(); never hardcoded. Fail-open on any parse
 * or evaluation error so a guard defect cannot wedge the agent.
 */

import { homedir } from "os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "path";
import {
  getCommand,
  readInput,
  respond,
  warn,
  type CodewithHookInput,
  type CodewithHookOutput,
} from "../../codewith-native-common";

const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const PATCH_TOOLS = new Set(["apply_patch", "ApplyPatch", "functions.apply_patch"]);

const DEFAULT_ORGS = ["hasna", "hasnaxyz", "hasna-products"];

const RULE = "workspace-repos-guard";

function reposRoot(home: string): string {
  return join(home, ".hasna", "repos", "clones");
}

/**
 * Legacy repo-checkout root, still live and populated during the migration
 * window (see the header comment). Guarded identically to the canonical clones
 * root until ~/workspace/repos is decommissioned fleet-wide.
 */
function legacyRoot(home: string): string {
  return join(home, "workspace", "repos");
}

function protectedRoots(home: string): string[] {
  return [reposRoot(home), legacyRoot(home)];
}

export function resolveAllowedOrgs(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.WORKSPACE_REPOS_GUARD_ORGS;
  if (typeof raw !== "string" || !raw.trim()) return new Set(DEFAULT_ORGS);
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

type Operation = "read" | "write" | "delete";

interface Verdict {
  blocked: boolean;
  reason?: string;
}

/**
 * Classify a single absolute target path against one protected repo-checkout
 * root. Structure only: a write at depth >= 2 inside an allowed org passes,
 * and anything else (deletes at any depth, writes at the root or org level,
 * writes into a non-allowed org) is blocked. Paths outside this root are not
 * this hook's concern and pass.
 */
export function classifyPath(target: string, root: string, orgs: Set<string>, op: Operation): Verdict {
  if (op === "read") return { blocked: false };
  let rel = relative(root, target);
  if (rel === "") {
    if (op === "delete") return { blocked: true, reason: `[${RULE}] delete of the protected repo-checkout root is forbidden: ${root}` };
    return { blocked: true, reason: `[${RULE}] writes directly to the protected repo-checkout root are forbidden: ${root}` };
  }
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    return { blocked: false };
  }
  const segments = rel.split(sep).filter(Boolean);

  if (op === "delete") {
    return { blocked: true, reason: `[${RULE}] delete under the protected repo-checkout root (${root}) is forbidden at any depth: ${target}` };
  }

  if (segments.length <= 1) {
    return {
      blocked: true,
      reason: `[${RULE}] writing would create a top-level entry directly under the protected repo-checkout root (${root}); only GitHub-org folders belong there: ${target}`,
    };
  }

  const org = segments[0];
  if (!orgs.has(org)) {
    return {
      blocked: true,
      reason: `[${RULE}] '${org}' is not an allowed GitHub org under the protected repo-checkout root (${root}); allowed: ${[...orgs].join(", ")}: ${target}`,
    };
  }

  return { blocked: false };
}

const WRITE_FLAGS = /\b(?:-o|--output|-O|--output-document|-out)\b/;

/**
 * Classify the operation of one command segment (a `&&`/`||`/`;`-delimited
 * unit). Git is handled by its subcommand: clean|rm delete, clone|init write,
 * everything else (status/pull/fetch/log/diff/...) is read. Sed without an
 * in-place flag is a stream filter (redirection is caught separately);
 * rsync/scp/truncate and inline interpreters (python3 -c, node -e, bun -e)
 * are treated as writes — conservative: they only matter when a path under
 * the protected root is also present.
 */
function segmentOperation(segment: string): Operation {
  const trimmed = segment.trim();
  if (!trimmed) return "read";

  if (/(?:^|\s)(?:rm|rmdir|unlink|shred|trash|rmtree|del)(?:\s|$)/.test(trimmed)) return "delete";
  if (/\bgit\b/.test(trimmed)) {
    if (/\bgit\b[^;&|]*\b(?:clean|rm)\b/.test(trimmed)) return "delete";
    if (/\bgit\b[^;&|]*\b(?:clone|init)\b/.test(trimmed)) return "write";
    return "read";
  }
  if (/(?:^|\s)(?:mkdir|mkfile|touch|mv|cp|ln|tee|install|dd)(?:\s|$)/.test(trimmed)) return "write";
  if (/\b(?:curl|wget)\b/.test(trimmed)) {
    if (WRITE_FLAGS.test(trimmed)) return "write";
    return "read";
  }
  if (/\bsed\b/.test(trimmed)) {
    if (/(?:^|\s)-i\S*(?:\s|$)|--in-place(?:\s|$)/.test(trimmed)) return "write";
    // sed without -i is a filter; `>` redirection is caught by the check below.
  } else if (/\b(?:rsync|scp|truncate)\b/.test(trimmed)) {
    return "write";
  } else if (/(?:^|\s)(?:python3?|node|bun)\b[^;&|]*\s+-[ce](?:\s|$)/.test(trimmed)) {
    return "write";
  }
  if (/(?:^|[;&|])\s*echo\b/.test(trimmed) || /[>&]/.test(trimmed)) return "write";
  return "read";
}

interface PathTarget {
  path: string;
  op: Operation;
}

/**
 * Expand one token's home spelling (`~`, `~/...`, `$HOME`, `$HOME/...`,
 * `${HOME}`, `${HOME}/...`) to the resolved home, tolerating a single layer
 * of wrapping single/double quotes and a closing quote between the home
 * token and its path suffix (`"$HOME"/x`, `"${HOME}"/x` — Bash treats these
 * identically to the unquoted form, because double quotes allow parameter
 * expansion and adjacent quoted/unquoted parts concatenate into one word).
 * Non-home spellings are returned unchanged.
 */
export function expandHomeSpelling(token: string, home: string): string {
  let body = token.trim();
  const quoted = body.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) body = quoted[2];
  // Split-quote forms — `"$HOME"/x`, `"${HOME}"/x`, `"/home/hasna"/x`: the
  // quotes wrap only the home token, and Bash concatenates the adjacent
  // quoted and unquoted parts into the same word as the unquoted spelling.
  body = body.replace(/^"*\$HOME"*\//, "$HOME/");
  body = body.replace(/^"*\$\{HOME\}"*\//, "${HOME}/");
  if (body === "~") return home;
  if (body.startsWith("~/")) return join(home, body.slice(2));
  if (body === "$HOME" || body === "${HOME}") return home;
  if (body.startsWith("$HOME/")) return join(home, body.slice("$HOME/".length));
  if (body.startsWith("${HOME}/")) return join(home, body.slice("${HOME}/".length));
  const homeMatch = body.match(new RegExp(`^"*${regexEscape(home)}"*/`));
  if (homeMatch) return home + "/" + body.slice(homeMatch[0].length);
  return token;
}

/**
 * Strip one level of wrapping shell-group punctuation from a segment so a
 * subshell group like `(cd ~/.hasna/repos/clones && rm -rf hasna)` is analysed as
 * its parts after the `&&` split.
 */
function unwrapSegment(segment: string): string {
  let s = segment.trim();
  while (s.startsWith("(") || s.startsWith("{")) s = s.slice(1).trim();
  while (s.endsWith(")") || s.endsWith("}")) s = s.slice(0, -1).trim();
  return s;
}

function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract protected-repo-checkout targets from a Bash command. Recognises
 * explicit `~/...`, `$HOME/...`, `${HOME}/...` and literal-home references
 * (expanded before classification) under EITHER protected root (the canonical
 * clones root or the legacy workspace/repos root), plus a trailing relative
 * operand (`.`, `..`, a bare name) when the command `cd`s into one of the
 * protected roots or the command's cwd already sits under one. Tokens outside
 * both protected roots are ignored; reads are returned so callers can decide
 * (they are never blocked).
 */
export function bashTargets(command: string, home: string, cwd: string): PathTarget[] {
  if (!command) return [];
  const roots = protectedRoots(home);
  const segments = command.split(/\s*&&\s*|\s*\|\|\s*|;\s*|\n+/);

  const targets: PathTarget[] = [];
  let cwdUnderRepos: string | null = null;

  for (const rawSegment of segments) {
    const segment = unwrapSegment(rawSegment);
    const op = segmentOperation(segment);

    const cdMatch = segment.match(/(?:^|\s)cd(?:\s+(?:-[A-Za-z]+|--))*\s+([^\s;&|<>()\x60]+)/);
    if (cdMatch) {
      const cdTarget = expandHomeSpelling(cdMatch[1], home);
      if (cdTarget && roots.some((root) => cdTarget === root || cdTarget.startsWith(`${root}${sep}`))) {
        cwdUnderRepos = cdTarget;
      }
    }

    const homeLiteral = regexEscape(home);
    const suffix = roots.map((root) => regexEscape(root.slice(home.length + 1))).join("|");
    const prefixRe = new RegExp(`(?:~|\\$HOME"*|\\$\\{HOME\\}"*|${homeLiteral}"*)/(?:${suffix})`);
    const re = new RegExp(`(${prefixRe.source})([^\\s"';&|<>()\x60]*|$)`, "g");
    let m: RegExpExecArray | null;
    let foundExplicit = false;
    while ((m = re.exec(segment)) !== null) {
      foundExplicit = true;
      const expanded = expandHomeSpelling(m[0], home);
      targets.push({ path: normalize(expanded).replace(/\/+$/, ""), op });
    }

    if (!foundExplicit && (op === "delete" || op === "write")) {
      const base =
        cwdUnderRepos ??
        (roots.some((root) => cwd === root || cwd.startsWith(`${root}${sep}`)) ? cwd : null);
      if (base) {
        const relMatch = segment.match(/(?:^|\s)(\.\.?|[^\s"';&|<>()\x60/]+(?:\/[^\s"';&|<>()\x60]*)?)\s*$/);
        if (relMatch) {
          targets.push({ path: normalize(resolve(base, relMatch[1])), op });
        }
      }
    }
  }

  return targets;
}

const PATCH_FILE_RE = /^\s*\*\*\*\s+(Add File|Update File|Delete File):\s+(\S+)\s*$/gm;

/**
 * Extract targets from an apply_patch payload: the `*** Add File:` /
 * `*** Update File:` / `*** Delete File:` markers, resolved against cwd.
 * Add/Update classify as write; Delete classifies as delete.
 */
export function patchTargets(patch: string, cwd: string): PathTarget[] {
  const targets: PathTarget[] = [];
  let m: RegExpExecArray | null;
  while ((m = PATCH_FILE_RE.exec(patch)) !== null) {
    const op: Operation = m[1] === "Delete File" ? "delete" : "write";
    targets.push({ path: normalize(resolve(cwd, m[2])), op });
  }
  return targets;
}

export function evaluate(input: CodewithHookInput): { output: CodewithHookOutput; warnings: string[] } {
  const warnings: string[] = [];
  if (input.hook_event_name !== "PreToolUse") return { output: { continue: true }, warnings };

  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const home = homedir();
  const roots = protectedRoots(home);
  const orgs = resolveAllowedOrgs();

  if (tool === "Bash") {
    const command = getCommand(input);
    if (!command) return { output: { continue: true }, warnings };
    const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
    const targets = bashTargets(command, home, cwd);
    for (const target of targets) {
      for (const root of roots) {
        const verdict = classifyPath(target.path, root, orgs, target.op);
        if (verdict.blocked) {
          return { output: { decision: "block", reason: verdict.reason }, warnings };
        }
      }
    }
    return { output: { continue: true }, warnings };
  }

  const toolInput = input.tool_input ?? {};
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  if (PATCH_TOOLS.has(tool)) {
    const patch = typeof toolInput.patch === "string" ? toolInput.patch : "";
    if (!patch) return { output: { continue: true }, warnings };
    const targets = patchTargets(patch, cwd);
    for (const target of targets) {
      for (const root of roots) {
        const verdict = classifyPath(target.path, root, orgs, target.op);
        if (verdict.blocked) {
          return { output: { decision: "block", reason: verdict.reason }, warnings };
        }
      }
    }
    return { output: { continue: true }, warnings };
  }

  if (!FILE_WRITE_TOOLS.has(tool)) return { output: { continue: true }, warnings };

  const raw =
    typeof toolInput.file_path === "string"
      ? toolInput.file_path
      : typeof toolInput.path === "string"
        ? toolInput.path
        : typeof toolInput.notebook_path === "string"
          ? toolInput.notebook_path
          : null;
  if (!raw) return { output: { continue: true }, warnings };

  const expanded = expandHomeSpelling(raw, home);
  const target = isAbsolute(expanded) ? normalize(expanded) : resolve(cwd, expanded);
  for (const root of roots) {
    const verdict = classifyPath(target, root, orgs, "write");
    if (verdict.blocked) {
      return { output: { decision: "block", reason: verdict.reason }, warnings };
    }
  }
  return { output: { continue: true }, warnings };
}

export async function run(): Promise<void> {
  const input = readInput();
  try {
    const { output, warnings } = evaluate(input);
    for (const message of warnings) warn(message);
    respond(output);
  } catch (error) {
    warn(`${RULE} failed open: ${error instanceof Error ? error.message : String(error)}`);
    respond({ continue: true });
  }
}

if (import.meta.main) {
  await run();
  process.exit(0);
}
