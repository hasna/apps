import type { ChangelogEntry, ChangelogKind, GenerateChangelogOptions } from "./types.js";

export const categoryHeadings: Record<ChangelogKind, string> = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  removed: "Removed",
  fixed: "Fixed",
  security: "Security",
  other: "Other",
};

export const categoryOrder: ChangelogKind[] = ["added", "changed", "deprecated", "removed", "fixed", "security", "other"];

export interface VersionGroup {
  version: string;
  date: string;
  entries: ChangelogEntry[];
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseSemver(version: string): SemverParts | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4] ?? "",
  };
}

function comparePrereleaseAsc(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number.parseInt(leftPart, 10) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number.parseInt(rightPart, 10) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function compareVersionsDesc(a: VersionGroup, b: VersionGroup): number {
  if (a.version === "Unreleased") return -1;
  if (b.version === "Unreleased") return 1;
  const semverA = parseSemver(a.version);
  const semverB = parseSemver(b.version);
  if (semverA && semverB) {
    for (const key of ["major", "minor", "patch"] as const) {
      if (semverA[key] !== semverB[key]) return semverB[key] - semverA[key];
    }
    return -comparePrereleaseAsc(semverA.prerelease, semverB.prerelease);
  }
  return b.date.localeCompare(a.date) || b.version.localeCompare(a.version);
}

export function groupChangelogEntries(entries: ChangelogEntry[]): VersionGroup[] {
  return groupEntries(entries);
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
  return groups.sort(compareVersionsDesc);
}

function repositoryRef(repositoryUrl: string | undefined, type: "commit" | "task", value: string): string {
  if (!repositoryUrl) return `${type} ${value}`;
  if (type === "commit" && /^[a-f0-9]{7,40}$/i.test(value)) {
    return `[commit ${value}](${repositoryUrl}/commit/${value})`;
  }
  const issue = value.match(/^#?(\d+)$/);
  if (type === "task" && issue) {
    return `[task ${value}](${repositoryUrl}/issues/${issue[1]})`;
  }
  return `${type} ${value}`;
}

function refsForEntry(entry: ChangelogEntry, repositoryUrl?: string): string[] {
  const refs: string[] = [];
  refs.push(...entry.tasks.map((task) => repositoryRef(repositoryUrl, "task", task)));
  refs.push(...entry.commits.map((commit) => repositoryRef(repositoryUrl, "commit", commit)));
  refs.push(...entry.links.map((link) => (link.label ? `[${link.label}](${link.url})` : link.url)));
  return refs;
}

function entryToMarkdown(entry: ChangelogEntry, repositoryUrl?: string): string[] {
  const lines: string[] = [];
  const message = entry.message && entry.message !== entry.title ? `: ${normalizeInline(entry.message)}` : "";
  lines.push(`- ${normalizeInline(entry.title)}${message}`);
  if (entry.details) {
    const detailLines = entry.details.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    lines.push(...detailLines.map((line) => `  ${line}`));
  }
  const refs = refsForEntry(entry, repositoryUrl);
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
        lines.push(...entryToMarkdown(entry, options.repositoryUrl));
      }
      lines.push("");
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
