/**
 * The brief gate for `todos delegate` — the FIRST effect the verb runs, before
 * any write.
 *
 * WHY IT IS THE FIRST STEP AND NOT A LATE VALIDATION: a bad invocation must
 * cost nothing. `delegate` performs seven ordered effects across two stores and
 * one sibling CLI, and only the first three are cheaply reversible. Refusing an
 * absent brief after the agent registration has landed would leave a
 * half-delegated row, which is precisely the partial-pipeline state the verb
 * exists to remove.
 *
 * WHY THE GATE IS A PURE FUNCTION OVER INJECTED SOURCES: the requirement on
 * this gate is that it be TWO-SIDED — provably able to refuse AND provably able
 * to accept, from real inputs. A gate wired directly to `node:fs` can only be
 * exercised through the filesystem, so the refusal cases that matter most
 * (unreadable path, whitespace-only body) become awkward enough to test that
 * they get tested once, on the happy path, which is the shape of a check that
 * cannot fail. Injecting the two readers makes every branch reachable from a
 * literal.
 *
 * The emptiness test TRIMS but the stored text does NOT. A brief is an artefact
 * the worker is told to read, and the sha256 recorded in the [DISPATCH] comment
 * has to be the digest of the bytes that are actually on disk — silently
 * rewriting the content would make that digest a statement about a file nobody
 * has.
 */
import { createHash } from "node:crypto";

export interface DelegationBriefInput {
  /** `--brief <path>`; the literal `-` means stdin. */
  briefPath?: string | undefined;
  /** `--brief-text <text>`. Mutually exclusive with {@link briefPath}. */
  briefText?: string | undefined;
}

/** The two reads the gate needs, injected so every branch is testable. */
export interface DelegationBriefSources {
  /** Reads a file as utf8; THROWS when the path cannot be read. */
  readFile(path: string): string;
  /** Reads stdin to end as utf8. */
  readStdin(): string;
}

export type DelegationBriefRefusal = "missing" | "conflict" | "unreadable" | "empty";

export type DelegationBriefVerdict =
  | {
      ok: true;
      /** The brief exactly as read — never trimmed. */
      text: string;
      /** Where it came from, for the [DISPATCH] record: a path, `(stdin)`, or `(--brief-text)`. */
      source: string;
      /** sha256 of the utf8 bytes of {@link text}. */
      sha256: string;
      /** Byte length of {@link text}. */
      bytes: number;
    }
  | { ok: false; reason: DelegationBriefRefusal; message: string };

const STDIN_SENTINEL = "-";

export function resolveDelegationBrief(
  input: DelegationBriefInput,
  sources: DelegationBriefSources,
): DelegationBriefVerdict {
  const hasPath = typeof input.briefPath === "string" && input.briefPath.length > 0;
  const hasText = typeof input.briefText === "string" && input.briefText.length > 0;

  if (hasPath && hasText) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "Pass either --brief <path> or --brief-text <text>, not both. " +
        "Two briefs means the worker is told two things and the [DISPATCH] record can only name one.",
    };
  }

  if (!hasPath && !hasText) {
    return {
      ok: false,
      reason: "missing",
      message:
        "A delegation needs a brief: pass --brief <path> (or --brief - to read stdin), or --brief-text <text>. " +
        "A dispatched worker sees no announcement, no channel and no rule published after it starts, " +
        "so anything it is not told in the brief it will never learn.",
    };
  }

  let text: string;
  let source: string;

  if (hasPath) {
    const path = input.briefPath!;
    if (path === STDIN_SENTINEL) {
      try {
        text = sources.readStdin();
      } catch (error) {
        return {
          ok: false,
          reason: "unreadable",
          message: `Could not read the brief from stdin: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      source = "(stdin)";
    } else {
      try {
        text = sources.readFile(path);
      } catch (error) {
        return {
          ok: false,
          reason: "unreadable",
          // Naming the path is load-bearing: without it the caller debugs the
          // wrong file, and a delegation brief is usually one of several.
          message: `Could not read the brief at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      source = path;
    }
  } else {
    text = input.briefText!;
    source = "(--brief-text)";
  }

  if (text.trim().length === 0) {
    return {
      ok: false,
      reason: "empty",
      message:
        `The brief at ${source} is empty (it contains only whitespace). ` +
        "An empty brief is worse than no brief, because the dispatch record would claim the worker was briefed.",
    };
  }

  return {
    ok: true,
    text,
    source,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}
