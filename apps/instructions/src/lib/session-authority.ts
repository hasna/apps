import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH = "AGENTS.md";
const CLAUDE_LEGACY_AUTHORITY_MAX_BYTES = 256 * 1024;

const CLAUDE_LEGACY_MARKERS = [
  { id: "claude-agent-rules-heading", pattern: /^# Agent Rules \(Claude\)/m },
  { id: "no-worktrees-heading", pattern: /^## No Worktrees/m },
  { id: "no-worktrees-directive", pattern: /\bNever use git worktrees\b/m },
] as const;

/**
 * A registered Instructions config (category=rules, agent=claude, kind=file)
 * whose target_path is a Claude-home AGENTS.md. Callers load these from the
 * config store; the guard itself stays pure so it cannot silently depend on
 * store state. Matching is on the NORMALIZED target path — the same identity
 * rule apply.ts uses for config targets — so a `~/.claude/AGENTS.md` spelling
 * and an absolute spelling of the same file are one target.
 */
export interface ClaudeOwnedAuthority {
  slug: string;
  targetPath: string;
  content: string;
}

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
    detection: "known-legacy-markers" | "unknown-content" | "non-regular-file" | "oversized-file" | "owned-config-drift";
  };
  reason: string;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function configHomeDir(): string {
  return process.env["CONFIGS_HOME"] || process.env["HOME"] || homedir();
}

/**
 * Normalize a config target path the way apply.ts's `normalizeTargetPath` does:
 * expand `~/`, then resolve through realpath. Kept local rather than importing
 * apply.js because this fail-closed guard is imported by both session-render
 * and session-apply, and importing apply.js would close an import cycle
 * (apply -> session-render -> session-authority -> apply).
 */
function normalizeOwnedTargetPath(p: string): string {
  const expanded = p.startsWith("~/") ? resolve(configHomeDir(), p.slice(2)) : resolve(p);
  try {
    return realpathSync(expanded);
  } catch {
    return expanded;
  }
}

/**
 * Claude reads AGENTS.md from its config home alongside CLAUDE.md. The session
 * renderer owns only CLAUDE.md and its managed fragments, so an unmanaged
 * AGENTS.md can remain a second authority. Treat every such file as a conflict:
 * known legacy no-worktree content is classified for migration evidence, while
 * unknown content fails closed rather than being guessed safe.
 *
 * The one recognized pass state, besides no file at all: the file is owned by
 * a registered Instructions config (category=rules, agent=claude, kind=file)
 * whose stored content equals the disk content. Such a file is managed by this
 * pipeline, so the render proceeds. An owned config whose stored content
 * drifts from disk still fails closed — the drift means the file is not
 * currently the pipeline's output.
 */
export function detectClaudeAuthorityConflicts(
  targetHome: string,
  ownedAuthorities: ClaudeOwnedAuthority[] = [],
): ClaudeAuthorityConflict[] {
  const authorityPath = resolve(join(targetHome, CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH));
  let stat: Stats;
  try {
    stat = lstatSync(authorityPath);
  } catch {
    return [];
  }

  const provenanceBase = {
    tool: "claude" as const,
    relativePath: CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH as typeof CLAUDE_LEGACY_AUTHORITY_RELATIVE_PATH,
    path: authorityPath,
  };
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
  const owned = ownedAuthorities.find(
    (authority) => normalizeOwnedTargetPath(authority.targetPath) === normalizeOwnedTargetPath(authorityPath),
  );
  if (owned) {
    if (owned.content === content) return [];
    return [{
      ...provenanceBase,
      kind: "unknown-unmanaged-authority",
      sha256: sha256(content),
      markers: [],
      provenance: {
        source: "filesystem",
        authority: "unmanaged",
        observedPath: authorityPath,
        detection: "owned-config-drift",
      },
      reason: `Claude target AGENTS.md is owned by registered config "${owned.slug}", but the disk file drifts from its stored content; re-sync the config through the instructions pipeline before applying.`,
    }];
  }
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
