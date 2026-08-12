import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH = "AGENTS.md";
const CLAUDE_LEGACY_AUTHORITY_MAX_BYTES = 256 * 1024;

const CLAUDE_LEGACY_MARKERS = [
  { id: "claude-agent-rules-heading", pattern: /^# Agent Rules \(Claude\)/m },
  { id: "no-worktrees-heading", pattern: /^## No Worktrees/m },
  { id: "no-worktrees-directive", pattern: /\bNever use git worktrees\b/m },
] as const;

export type ClaudeAuthorityConflictKind =
  | "known-legacy-no-worktree"
  | "unknown-unmanaged-authority"
  | "invalid-unmanaged-authority";

export interface ClaudeAuthorityConflict {
  tool: "claude";
  relativePath: typeof CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH;
  path: string;
  kind: ClaudeAuthorityConflictKind;
  sha256: string | null;
  markers: string[];
  provenance: {
    source: "filesystem";
    authority: "unmanaged";
    observedPath: string;
    detection: "known-legacy-markers" | "unknown-content" | "non-regular-file" | "oversized-file";
  };
  reason: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Claude reads AGENTS.md from its config home alongside CLAUDE.md. The session
 * renderer owns only CLAUDE.md and its managed fragments, so an unmanaged
 * AGENTS.md can remain a second authority. Treat every such file as a conflict:
 * known legacy no-worktree content is classified for migration evidence, while
 * unknown content fails closed rather than being guessed safe.
 */
export function detectClaudeAuthorityConflicts(targetHome: string): ClaudeAuthorityConflict[] {
  const authorityPath = resolve(join(targetHome, CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH));
  if (!existsSync(authorityPath)) return [];

  const provenanceBase = {
    tool: "claude" as const,
    relativePath: CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH as typeof CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH,
    path: authorityPath,
  };
  const stat = lstatSync(authorityPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return [{
      ...provenanceBase,
      kind: "invalid-unmanaged-authority",
      sha256: null,
      markers: [],
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "non-regular-file",
      },
      reason: "Claude target contains unmanaged AGENTS.md that is not a regular file; authority cannot be verified safely.",
    }];
  }
  if (statSync(authorityPath).size > CLAUDE_LEGACY_AUTHORITY_MAX_BYTES) {
    return [{
      ...provenanceBase,
      kind: "invalid-unmanaged-authority",
      sha256: null,
      markers: [],
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "oversized-file",
      },
      reason: `Claude target contains unmanaged AGENTS.md larger than ${CLAUDE_LEGACY_AUTHORITY_MAX_BYTES} bytes; authority cannot be classified safely.`,
    }];
  }

  const content = readFileSync(authorityPath, "utf8");
  const markers = CLAUDE_LEGACY_MARKERS
    .filter((marker) => marker.pattern.test(content))
    .map((marker) => marker.id);
  const knownLegacy = markers.includes("no-worktrees-heading")
    && markers.includes("no-worktrees-directive");
  return [{
    ...provenanceBase,
    kind: knownLegacy ? "known-legacy-no-worktree" : "unknown-unmanaged-authority",
    sha256: sha256(content),
    markers,
    provenance: {
      source: "filesystem",
      authority: "unmanaged",
      observedPath: authorityPath,
      detection: knownLegacy ? "known-legacy-markers" : "unknown-content",
    },
    reason: knownLegacy
      ? "Claude target contains unmanaged legacy AGENTS.md with no-worktree directives; migrate or remove it through an owned authority path before applying."
      : "Claude target contains unmanaged AGENTS.md with unknown authority content; refusing to guess whether it conflicts with the managed Claude render.",
  }];
}
