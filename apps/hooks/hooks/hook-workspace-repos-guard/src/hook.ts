#!/usr/bin/env bun

/**
 * PreToolUse hook: workspace-repos-guard
 *
 * Guards the canonical workspace structure (knowledge k_mssu9jdq_dgnnu2):
 * $HOME/workspace contains ONLY repos/ + scratch/ + AGENTS.md, and repos/
 * contains ONLY GitHub-org folders. Checkouts at
 * $HOME/workspace/repos/<org>/<repo>/ are read/context only.
 *
 * Structure-only guard — it deliberately does NOT duplicate the worktree-guard
 * hook, which owns edits-in-shared-checkouts semantics.
 *
 * BLOCKS:
 *   - any write to $HOME/workspace/repos itself (file tools and Bash),
 *   - any write that would create a top-level entry under repos/ (depth <= 1),
 *   - any write whose second path segment is not an allowed GitHub org,
 *   - any delete (rm, rmdir, git clean, git rm, unlink, shred, trash, ...)
 *     anywhere under $HOME/workspace/repos, at any depth.
 *
 * ALLOWS (structure only):
 *   - reads, always,
 *   - writes deeper inside an allowed org folder (repos/<org>/<repo>/...).
 *
 * Allowed orgs default to hasna,hasnaxyz,hasna-internal,hasna-products and are
 * overridable with the WORKSPACE_REPOS_GUARD_ORGS env var (comma-separated).
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

const FILE_WRITE_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "apply_patch",
  "ApplyPatch",
  "functions.apply_patch",
]);

const DEFAULT_ORGS = ["hasna", "hasnaxyz", "hasna-internal", "hasna-products"];

const RULE = "workspace-repos-guard";

function reposRoot(home: string): string {
  return join(home, "workspace", "repos");
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
 * Classify a single absolute target path against the repos root. Structure
 * only: a write at depth >= 2 inside an allowed org passes, and anything else
 * (deletes at any depth, writes at the root or org level, writes into a
 * non-allowed org) is blocked. Paths outside the repos root are not this
 * hook's concern and pass.
 */
export function classifyPath(target: string, root: string, orgs: Set<string>, op: Operation): Verdict {
  if (op === "read") return { blocked: false };
  let rel = relative(root, target);
  if (rel === "") {
    if (op === "delete") return { blocked: true, reason: `[${RULE}] delete of the repos root is forbidden: ${root}` };
    return { blocked: true, reason: `[${RULE}] writes directly to the repos root are forbidden: ${root}` };
  }
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
    return { blocked: false };
  }
  const segments = rel.split(sep).filter(Boolean);

  if (op === "delete") {
    return { blocked: true, reason: `[${RULE}] delete under ~/workspace/repos is forbidden at any depth: ${target}` };
  }

  if (segments.length <= 1) {
    return {
      blocked: true,
      reason: `[${RULE}] writing would create a top-level entry directly under repos/; only GitHub-org folders belong there: ${target}`,
    };
  }

  const org = segments[0];
  if (!orgs.has(org)) {
    return {
      blocked: true,
      reason: `[${RULE}] '${org}' is not an allowed GitHub org under ~/workspace/repos (allowed: ${[...orgs].join(", ")}): ${target}`,
    };
  }

  return { blocked: false };
}

const WRITE_FLAGS = /\b(?:-o|--output|-O|--output-document|-out)\b/;

/**
 * Classify the operation of one command segment (a `&&`/`||`/`;`-delimited
 * unit). Git is handled by its subcommand: clean|rm delete, clone|init write,
 * everything else (status/pull/fetch/log/diff/...) is read.
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
  if (/(?:^|[;&|])\s*echo\b/.test(trimmed) || /[>&]/.test(trimmed)) return "write";
  return "read";
}

interface BashTarget {
  path: string;
  op: Operation;
}

function expandToken(token: string, home: string): string | null {
  if (token.startsWith("~/")) return join(home, token.slice(2));
  if (token.startsWith("$HOME/")) return join(home, token.slice(6));
  if (token.startsWith("${HOME}/")) return join(home, token.slice(8));
  if (token.startsWith(home)) return token;
  return null;
}

function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract workspace-repos targets from a Bash command. Recognises explicit
 * `~/...`, `$HOME/...`, `${HOME}/...` and literal-home references, plus a
 * trailing relative operand (`.`, `..`, a bare name) when the command first
 * `cd`s into the repos root. Tokens outside the repos root are ignored; reads
 * are returned so callers can decide (they are never blocked).
 */
export function bashTargets(command: string, home: string): BashTarget[] {
  if (!command) return [];
  const root = reposRoot(home);
  const segments = command.split(/\s*&&\s*|\s*\|\|\s*|;/);

  const targets: BashTarget[] = [];
  let cwdUnderRepos: string | null = null;

  for (const segment of segments) {
    const op = segmentOperation(segment);

    const cdMatch = segment.match(/(?:^|\s)cd(?:\s+[^\s"';&|<>()\x60]+)*\s+([^\s"';&|<>()\x60]+)/);
    if (cdMatch) {
      const cdTarget = expandToken(cdMatch[1], home);
      if (cdTarget && (cdTarget === root || cdTarget.startsWith(`${root}${sep}`))) cwdUnderRepos = cdTarget;
    }

    const homeLiteral = regexEscape(home);
    const prefixRe = new RegExp(`(?:~|\\$HOME|\\$\\{HOME\\}|${homeLiteral})/workspace/repos`);
    const re = new RegExp(`(${prefixRe.source})([^\\s"';&|<>()\x60]*|$)`, "g");
    let m: RegExpExecArray | null;
    let foundExplicit = false;
    while ((m = re.exec(segment)) !== null) {
      foundExplicit = true;
      targets.push({ path: normalize(m[0]).replace(/\/+$/, ""), op });
    }

    if (!foundExplicit && (op === "delete" || op === "write") && cwdUnderRepos) {
      const relMatch = segment.match(/(?:^|\s)(\.\.?|[^\s"';&|<>()\x60/]+(?:\/[^\s"';&|<>()\x60]*)?)\s*$/);
      if (relMatch) {
        targets.push({ path: normalize(resolve(cwdUnderRepos, relMatch[1])), op });
      }
    }
  }

  return targets;
}

export function evaluate(input: CodewithHookInput): { output: CodewithHookOutput; warnings: string[] } {
  const warnings: string[] = [];
  if (input.hook_event_name !== "PreToolUse") return { output: { continue: true }, warnings };

  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const home = homedir();
  const root = reposRoot(home);
  const orgs = resolveAllowedOrgs();

  if (tool === "Bash") {
    const command = getCommand(input);
    if (!command) return { output: { continue: true }, warnings };
    const targets = bashTargets(command, home);
    for (const target of targets) {
      const verdict = classifyPath(target.path, root, orgs, target.op);
      if (verdict.blocked) {
        return { output: { decision: "block", reason: verdict.reason }, warnings };
      }
    }
    return { output: { continue: true }, warnings };
  }

  if (!FILE_WRITE_TOOLS.has(tool)) return { output: { continue: true }, warnings };

  const toolInput = input.tool_input ?? {};
  const raw =
    typeof toolInput.file_path === "string"
      ? toolInput.file_path
      : typeof toolInput.path === "string"
        ? toolInput.path
        : typeof toolInput.notebook_path === "string"
          ? toolInput.notebook_path
          : null;
  if (!raw) return { output: { continue: true }, warnings };

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const target = isAbsolute(raw) ? normalize(raw) : resolve(cwd, raw);
  const verdict = classifyPath(target, root, orgs, "write");
  if (verdict.blocked) {
    return { output: { decision: "block", reason: verdict.reason }, warnings };
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
