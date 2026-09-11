/**
 * The guard's decision layer: given a command string, decide ALLOW, REWRITE or
 * DENY, and — when rewriting — produce the rewritten command.
 *
 * It sits between `scan.ts` (which finds delete verbs and their byte spans) and
 * `run.ts` (which executes the intercepted delete). Everything here is a pure
 * function of the command string plus a small amount of context (home, cwd,
 * spool), so the whole decision is testable without a hook harness.
 *
 * =========================================================================
 * THE FAIL RULES (§3)
 * =========================================================================
 *
 *   no delete verb in command position  -> ALLOW, emit nothing
 *   every target enumerable             -> REWRITE every verb span at once
 *   anything else                       -> DENY
 *
 * "At once" is load-bearing. A partial rewrite is the worst outcome available:
 * `rm -rf a; rmdir b` rewritten only on the first span would delete `a` into
 * the trash and then run the REAL `rmdir b` — a command that neither refuses
 * nor captures, and whose exit code looks perfectly normal. So a rewrite edit
 * list is all-or-nothing, and a single unenumerable target anywhere in the
 * command denies the WHOLE command rather than letting the rest through.
 *
 * =========================================================================
 * WHY A DENY IS NOT A FAILURE
 * =========================================================================
 *
 * §11.3 / §15 correction 9 make denial the correct answer for three classes:
 *
 *   1. the protected-root class (`/`, `~`, `~/.ssh`, a repository root, …) —
 *      these are exactly the deletes that must not be routable through a tool
 *      whose job is to make deletion easy;
 *   2. verbs in another grammar (`git rm`, `find -delete`, `git clean`,
 *      `find -exec`) whose semantics the guard cannot reproduce — `git rm
 *      --cached` does not touch the working file, and `find -delete` has no
 *      token to swap;
 *   3. a delete the scanner cannot SEE (behind `xargs`, `eval`, a nested
 *      shell, a command substitution, a privilege transition) — an
 *      unenumerable delete is not the same as an absent one, and pretending
 *      otherwise is how a guard becomes decorative.
 *
 * A denial is a refusal with an instruction attached, never a silent pass.
 */

import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkProtectedPath } from "../lib/inspect.js";
import { applySpanEdits, quoteForShell, scanDeleteVerbs, type DeleteVerbHit, type SpanEdit } from "./scan.js";

export type GuardDecisionKind = "allow" | "rewrite" | "deny";

export interface GuardDecision {
  kind: GuardDecisionKind;
  /** The command to run: unchanged for allow/deny, rewritten for rewrite. */
  command: string;
  /** One line explaining the decision. Always populated, including for allow. */
  reason: string;
  /** Every delete verb the scanner saw, in source order. */
  hits: readonly DeleteVerbHit[];
  /** The literal targets the decision considered (post-`--`, pre-expansion). */
  targets: readonly string[];
  /** How many spans were swapped (`0` unless `kind === "rewrite"`). */
  rewritten: number;
}

export interface PlanOptions {
  /**
   * Absolute path to the trash store — embedded in the rewritten command.
   *
   * Empty means "do not embed one": the rewritten command then resolves the
   * store from its own environment, the default layout. The hook always passes
   * a real path because §4's two-context resolution means an environment
   * variable set in the hook child never reaches the process that later runs
   * the rewritten command — command text does.
   */
  spool?: string;
  /** The program that will be invoked in the rewritten command. */
  trashBin?: string;
  home: string;
  cwd: string;
  /** Roots the store owns; they are protected in full, exactly as the store does. */
  extraProtectedRoots?: readonly string[];
  /** The hook's own deny-prefix guard list, if it has one. */
  extraDenyRoots?: readonly string[];
}

/** The verb → program-argument mapping the rewrite emits. */
function guardPrefix(hit: DeleteVerbHit, options: PlanOptions): string {
  const trashBin = options.trashBin ?? "trash";
  const parts = [trashBin, "guard"];
  if (hit.verb === "rmdir") parts.push("--rmdir");
  if (options.spool !== undefined && options.spool.length > 0) {
    parts.push("--spool", quoteForShell(options.spool));
  }
  return parts.join(" ");
}

function isOptionWord(word: string): boolean {
  return word.startsWith("-") && word.length > 1;
}

interface TargetScan {
  targets: string[];
  /** Set when a target cannot be enumerated without running the command. */
  unenumerable: string | null;
}

/**
 * The literal targets of a delete verb, and whether any of them is a word the
 * guard cannot resolve ahead of time.
 *
 * `--` ends the option run; every later word is an operand, even one that
 * starts with `-` (`rm -- -weird`). A quoted `'*'` is a literal path and is
 * enumerable; an unquoted `*` is not, and neither is `$FILE` or `$(cat list)`.
 */
function scanTargets(hit: DeleteVerbHit): TargetScan {
  const targets: string[] = [];
  let optionsDone = false;
  for (const arg of hit.args) {
    if (!optionsDone && arg.text === "--") {
      optionsDone = true;
      continue;
    }
    if (!optionsDone && isOptionWord(arg.text)) continue;
    if (arg.hasSubstitution) {
      return { targets, unenumerable: `\`${arg.raw}\` runs a command the guard cannot resolve before the delete` };
    }
    if (arg.hasVariable) {
      return { targets, unenumerable: `\`${arg.raw}\` expands to a path only at run time` };
    }
    if (arg.hasGlob) {
      return { targets, unenumerable: `\`${arg.raw}\` is a glob that only the shell can expand` };
    }
    targets.push(arg.text);
  }
  return { targets, unenumerable: null };
}

/**
 * Resolve one operand the way the shell will, WITHOUT touching the filesystem.
 *
 * A leading `~` is expanded here rather than left to `resolve`, which would
 * read it as a directory literally named `~` under the cwd and let
 * `rm -rf ~/.ssh` walk straight past the protected class §11.3 names
 * explicitly. `~user` cannot be expanded without a passwd lookup, so it is
 * reported as unresolvable and refused rather than guessed at.
 *
 * Never canonicalized: no `realpath`, no symlink resolution. The guard decides
 * on the path the user wrote, and the store — which does its own `lstat`-only
 * inspection — makes the final call.
 */
function resolveTarget(target: string, options: PlanOptions): string | null {
  if (target === "~") return options.home;
  if (target.startsWith("~/")) return join(options.home, target.slice(2));
  if (target.startsWith("~")) return null;
  return resolve(options.cwd, target);
}

/** A repository root is protected as a whole (§11.3): a delete must not take the history with it. */
function isRepositoryRoot(absolutePath: string): boolean {
  try {
    // `.git` is a directory in a normal clone and a FILE in a linked worktree;
    // `lstat` answers for both, and a dangling `.git` symlink still counts.
    lstatSync(join(absolutePath, ".git"));
    return true;
  } catch {
    return false;
  }
}

function protectedReason(absolutePath: string, options: PlanOptions): string | null {
  const extra = [...(options.extraProtectedRoots ?? []), ...(options.extraDenyRoots ?? [])];
  const hit = checkProtectedPath(absolutePath, { home: options.home, extraRoots: extra });
  if (hit) return hit;
  if (isRepositoryRoot(absolutePath)) return `repository root ${absolutePath}`;
  return null;
}

/**
 * Decide what to do with a command string.
 *
 * Never throws for a malformed command — a command the scanner cannot read is
 * a DENY, because the alternative is an unreported pass-through.
 */
export function planGuardCommand(command: string, options: PlanOptions): GuardDecision {
  const scan = scanDeleteVerbs(command);
  if (scan.hits.length === 0) {
    return {
      kind: "allow",
      command,
      reason: "no delete verb in command position",
      hits: [],
      targets: [],
      rewritten: 0,
    };
  }

  // §3 fail rule: a lex that did not reach the end cannot be trusted to have
  // found every verb, so nothing in it may be rewritten.
  if (scan.unterminated) {
    return {
      kind: "deny",
      command,
      reason:
        "the command has an unterminated quote, substitution or backtick, so the guard cannot see where the delete ends. Close the quote (or run the delete as its own command) and try again.",
      hits: scan.hits,
      targets: [],
      rewritten: 0,
    };
  }

  // A refusal anywhere denies the whole command — never a partial rewrite.
  const refused = scan.hits.find((hit) => hit.disposition === "refuse");
  if (refused) {
    return {
      kind: "deny",
      command,
      reason: refused.reason.length > 0 ? refused.reason : `${refused.verb} is outside the guard's grammar`,
      hits: scan.hits,
      targets: [],
      rewritten: 0,
    };
  }

  const rewrites = scan.hits.filter((hit) => hit.disposition === "rewrite");
  const targets: string[] = [];
  const edits: SpanEdit[] = [];

  for (const hit of rewrites) {
    const { targets: hitTargets, unenumerable } = scanTargets(hit);
    if (unenumerable) {
      return {
        kind: "deny",
        command,
        reason: `${unenumerable}, so the guard cannot tell whether the delete is protected. Re-run the delete with a literal path, e.g. \`rm -rf -- ./build\`.`,
        hits: scan.hits,
        targets,
        rewritten: 0,
      };
    }
    for (const target of hitTargets) {
      const absolute = resolveTarget(target, options);
      if (absolute === null) {
        return {
          kind: "deny",
          command,
          reason: `${target} names another user's home directory, which the guard cannot resolve — and will not guess at. Re-run the delete with that absolute path if you mean it.`,
          hits: scan.hits,
          targets: [...targets, ...hitTargets],
          rewritten: 0,
        };
      }
      const reason = protectedReason(absolute, options);
      if (reason) {
        // §11.3: the protected class is denied, never routed through the guard.
        return {
          kind: "deny",
          command,
          reason: `${target} is in the protected class (${reason}) — the guard will not delete it. Remove it by hand if that is truly what you mean.`,
          hits: scan.hits,
          targets: [...targets, ...hitTargets],
          rewritten: 0,
        };
      }
    }
    targets.push(...hitTargets);
    edits.push({ span: hit.span, text: guardPrefix(hit, options) });
  }

  return {
    kind: "rewrite",
    command: applySpanEdits(command, edits),
    reason: `rewrote ${edits.length} delete verb${edits.length === 1 ? "" : "s"} to the trash guard`,
    hits: scan.hits,
    targets,
    rewritten: edits.length,
  };
}

/** The JSON shape `trash guard --plan` prints, so a hook can consume it without linking this package. */
export interface GuardPlanDocument {
  schema: "hasna.trash.guard-plan.v1";
  decision: GuardDecisionKind;
  command: string;
  reason: string;
  targets: readonly string[];
  hits: { verb: string; disposition: string; start: number; end: number; reason: string }[];
}

export function guardPlanDocument(decision: GuardDecision): GuardPlanDocument {
  return {
    schema: "hasna.trash.guard-plan.v1",
    decision: decision.kind,
    command: decision.command,
    reason: decision.reason,
    targets: decision.targets,
    hits: decision.hits.map((hit) => ({
      verb: hit.verb,
      disposition: hit.disposition,
      start: hit.span.start,
      end: hit.span.end,
      reason: hit.reason,
    })),
  };
}

export { guardPrefix };
