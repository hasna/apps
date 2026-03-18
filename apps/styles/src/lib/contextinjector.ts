import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import type { StyleProfile } from "./profiles.js";
import type { StyleMeta } from "./registry.js";

const MARKER_START = "<!-- open-styles-start -->";
const MARKER_END = "<!-- open-styles-end -->";

export function buildContextSection(
  profile: StyleProfile | StyleMeta,
  prefs: Record<string, string>
): string {
  const displayName = profile.displayName;
  const principles = profile.principles.join(" · ");

  // antiPatterns is only on StyleProfile, not StyleMeta
  const antiPatterns =
    "antiPatterns" in profile && Array.isArray(profile.antiPatterns)
      ? profile.antiPatterns.join(" · ")
      : "";

  const prefEntries = Object.entries(prefs);
  const prefLine =
    prefEntries.length > 0
      ? prefEntries.map(([k, v]) => `${k}=${v}`).join(", ")
      : null;

  const lines = [
    MARKER_START,
    `## Design Style: ${displayName}`,
    ``,
    `> Managed by open-styles. Run \`styles inject-context\` to update.`,
    ``,
    `**Principles:** ${principles}`,
  ];

  if (antiPatterns) {
    lines.push(``, `**Anti-Patterns:** ${antiPatterns}`);
  }

  if (prefLine) {
    lines.push(``, `**Project prefs:** ${prefLine}`);
  }

  lines.push(MARKER_END);

  return lines.join("\n");
}

export function injectIntoClaudeMd(
  projectPath: string,
  profile: StyleProfile | StyleMeta,
  prefs: Record<string, string>
): { action: "created" | "updated" | "unchanged"; path: string } {
  const claudeMdPath = join(projectPath, "CLAUDE.md");
  const section = buildContextSection(profile, prefs);

  let existing = "";
  if (existsSync(claudeMdPath)) {
    existing = readFileSync(claudeMdPath, "utf-8");
  }

  // Check if markers already exist
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing section
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MARKER_END.length);
    const newContent = before + section + after;

    if (newContent === existing) {
      return { action: "unchanged", path: claudeMdPath };
    }

    writeFileSync(claudeMdPath, newContent, "utf-8");
    return { action: "updated", path: claudeMdPath };
  }

  // Append to file (or create it)
  const isNew = !existsSync(claudeMdPath);
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  const newContent = existing + separator + section + "\n";
  writeFileSync(claudeMdPath, newContent, "utf-8");
  return { action: isNew ? "created" : "updated", path: claudeMdPath };
}

export function removeFromClaudeMd(
  projectPath: string
): { action: "removed" | "not-found"; path: string } {
  const claudeMdPath = join(projectPath, "CLAUDE.md");

  if (!existsSync(claudeMdPath)) {
    return { action: "not-found", path: claudeMdPath };
  }

  const existing = readFileSync(claudeMdPath, "utf-8");
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { action: "not-found", path: claudeMdPath };
  }

  const before = existing.slice(0, startIdx).replace(/\n+$/, "");
  const after = existing.slice(endIdx + MARKER_END.length).replace(/^\n+/, "");

  const newContent =
    before.length > 0 && after.length > 0
      ? before + "\n\n" + after
      : before + after;

  writeFileSync(claudeMdPath, newContent.trimEnd() + (newContent.length > 0 ? "\n" : ""), "utf-8");
  return { action: "removed", path: claudeMdPath };
}
