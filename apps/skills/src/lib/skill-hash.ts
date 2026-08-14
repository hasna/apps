import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Canonical SKILL.md hash for home-vs-corpus comparison.
 *
 * The full portable-bundle canonical hash — skill.json blank-canonicalized plus
 * SKILL.md and every covered file under src/, scripts/, assets/, references/ —
 * is the metadata-contract work (hasna/apps PR #109, skill-contract/skill-hash),
 * which is not yet on main. Agent home directories carry only a SKILL.md, so
 * the home comparison hashes exactly that file, with the two agent-adaptation
 * deltas removed: `user_invocable` frontmatter lines (injected for Claude,
 * stripped for every other agent by sync) and line-ending variance. Two copies
 * that differ only in those two ways hash identically, so an ad-hoc copy that
 * matches the canonical SKILL.md byte-for-byte modulo adaptation is recognised
 * as an exact match.
 *
 * When PR #109 merges, this module must be reconciled with its skill-hash so
 * the fleet uses one canonical hashing utility.
 */
export const HOME_HASH_ALGORITHM = "sha256";
export const HOME_HASH_HEX_LENGTH = 64;

/** Normalize CRLF/CR to LF so the same document hashes identically everywhere. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * The agent-neutral document: frontmatter with every `user_invocable` line
 * removed (the one field sync adapts per agent), body verbatim, LF endings.
 * Mirrors adaptSkillMdForAgent's frontmatter handling so its output and the
 * canonical source normalize to the same document.
 */
export function canonicalAgentSkillMarkdown(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return normalizeLineEndings(content);
  const lines = match[1].split(/\r?\n/).filter((line) => !/^\s*user_invocable\s*:/i.test(line));
  return `---\n${lines.join("\n")}\n---\n${normalizeLineEndings(content.slice(match[0].length))}`;
}

/** Canonical hash of a SKILL.md document. */
export function hashSkillMarkdown(content: string): string {
  const hash = createHash(HOME_HASH_ALGORITHM);
  hash.update(canonicalAgentSkillMarkdown(content));
  return hash.digest("hex");
}

/** Canonical hash of the SKILL.md at `path`. */
export function hashSkillMarkdownFile(path: string): string {
  return hashSkillMarkdown(readFileSync(path, "utf-8"));
}
