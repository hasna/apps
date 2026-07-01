import type { ChangelogEntry, ChangelogKind, GenerateChangelogOptions } from "./types.js";

const categoryHeadings: Record<ChangelogKind, string> = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  removed: "Removed",
  fixed: "Fixed",
  security: "Security",
  other: "Other",
};

const categoryOrder: ChangelogKind[] = ["added", "changed", "deprecated", "removed", "fixed", "security", "other"];

interface VersionGroup {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function groupEntries(entries: ChangelogEntry[]): VersionGroup[] {
  const byVersion = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry]);
  }
  const groups = [...byVersion.entries()].map(([version, groupEntriesForVersion]) => {
    const sorted = [...groupEntriesForVersion].sort((a, b) => `${b.date}T${b.createdAt}`.localeCompare(`${a.date}T${a.createdAt}`));
    const first = sorted[0];
    return {
      version,
      date: first?.date ?? new Date().toISOString().slice(0, 10),
      entries: sorted,
    };
  });
  return groups.sort((a, b) => {
    if (a.version === "Unreleased") return -1;
    if (b.version === "Unreleased") return 1;
    return b.date.localeCompare(a.date) || b.version.localeCompare(a.version);
  });
}

function refsForEntry(entry: ChangelogEntry): string[] {
  const refs: string[] = [];
  refs.push(...entry.tasks.map((task) => `task ${task}`));
  refs.push(...entry.commits.map((commit) => `commit ${commit}`));
  refs.push(...entry.links.map((link) => (link.label ? `[${link.label}](${link.url})` : link.url)));
  return refs;
}

function entryToMarkdown(entry: ChangelogEntry): string[] {
  const lines: string[] = [];
  const message = entry.message && entry.message !== entry.title ? `: ${normalizeInline(entry.message)}` : "";
  lines.push(`- ${normalizeInline(entry.title)}${message}`);
  if (entry.details) {
    const detailLines = entry.details.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    lines.push(...detailLines.map((line) => `  ${line}`));
  }
  const refs = refsForEntry(entry);
  if (refs.length > 0) lines.push(`  Refs: ${refs.join(", ")}`);
  if (entry.author) lines.push(`  Author: ${entry.author}`);
  return lines;
}

export function generateChangelogMarkdown(entries: ChangelogEntry[], options: GenerateChangelogOptions = {}): string {
  const kind = options.kind ?? options.category;
  const filtered = entries
    .filter((entry) => !options.appId || entry.appId === options.appId)
    .filter((entry) => !options.version || entry.version === options.version)
    .filter((entry) => !kind || entry.kind === kind)
    .filter((entry) => !options.tag || entry.tags.includes(options.tag.toLowerCase()))
    .slice(0, options.limit ? Math.max(1, Math.min(options.limit, 500)) : undefined);
  const title = options.title ?? (options.appId ? `${options.appId} Changelog` : "Changelog");
  const lines: string[] = [`# ${title}`, ""];

  if (options.includeIntro ?? true) {
    lines.push("All notable changes are documented in this file.", "");
  }

  if (filtered.length === 0) {
    lines.push("## Unreleased", "", "No changes recorded yet.", "");
    return lines.join("\n");
  }

  for (const group of groupEntries(filtered)) {
    const heading = group.version === "Unreleased" ? "## Unreleased" : `## [${group.version}] - ${group.date}`;
    lines.push(heading, "");
    for (const kind of categoryOrder) {
      const categoryEntries = group.entries.filter((entry) => entry.kind === kind);
      if (categoryEntries.length === 0) continue;
      lines.push(`### ${categoryHeadings[kind]}`, "");
      for (const entry of categoryEntries) {
        lines.push(...entryToMarkdown(entry));
      }
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
