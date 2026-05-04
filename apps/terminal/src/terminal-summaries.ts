interface StatusSummary {
  branch?: string;
  count: number;
  counts: Record<string, number>;
  samples: string[];
}

function compactList(items: string[], limit: number): string {
  const shown = items.slice(0, limit);
  const suffix = items.length > limit ? `, +${items.length - limit} more` : "";
  return shown.join(", ") + suffix;
}

function parseBranch(line: string): string {
  const raw = line.replace(/^##\s+/, "").trim();
  const [name, tracking = ""] = raw.split("...");
  const state = tracking.match(/\[(.+)\]/)?.[1];
  if (state) return `${name} (${state})`;
  if (tracking) return `${name} (up to date)`;
  return name;
}

function statusKind(code: string): string {
  if (code === "??") return "untracked";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("C")) return "copied";
  if (code.includes("U")) return "conflicted";
  if (code.includes("M")) return "modified";
  return "changed";
}

function parseGitShortStatus(output: string, branchFallback?: string): StatusSummary | null {
  const lines = output.trim().split("\n").filter(Boolean);
  let branch = branchFallback;
  const statusLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      branch = parseBranch(line);
    } else if (/^(?:[ MADRCU?!]{2})\s+/.test(line)) {
      statusLines.push(line);
    }
  }

  if (!branch && statusLines.length === 0) return null;

  const counts: Record<string, number> = {};
  const samples: string[] = [];
  for (const line of statusLines) {
    const code = line.slice(0, 2);
    const kind = statusKind(code);
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (samples.length < 2) samples.push(line.slice(3).trim());
  }

  return { branch, count: statusLines.length, counts, samples };
}

export function summarizeGitShortStatus(output: string, branchFallback?: string): string | null {
  const parsed = parseGitShortStatus(output, branchFallback);
  if (!parsed) return null;

  const lines: string[] = [];
  const branch = parsed.count > 0 ? parsed.branch?.replace(/ \(up to date\)$/, "") : parsed.branch;
  if (branch) lines.push(`Branch: ${branch}`);
  if (parsed.count === 0) {
    lines.push("Clean working tree");
    return lines.join("\n");
  }

  const counts = Object.entries(parsed.counts).map(([kind, count]) => `${count} ${kind}`).join(", ");
  lines.push(`${parsed.count} changed: ${counts}`);
  return lines.join("\n");
}

export function summarizeSearchOutput(output: string): string | null {
  const lines = output.trim().split("\n").filter(Boolean);
  const matches = lines.map((line) => {
    const match = line.match(/^(.+?):(\d+)(?::\d+)?:([\s\S]*)$/);
    return match ? { file: match[1], line: match[2], text: match[3] } : null;
  }).filter((match): match is { file: string; line: string; text: string } => Boolean(match));

  if (matches.length < 2 || matches.length !== lines.length) return null;

  const fileCounts = new Map<string, number>();
  for (const match of matches) fileCounts.set(match.file, (fileCounts.get(match.file) ?? 0) + 1);
  const topFiles = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([file, count]) => `${file} x${count}`);

  return [
    `${matches.length} matches in ${fileCounts.size} files`,
    `Top: ${compactList(topFiles, 5)}`,
  ].join("\n");
}

export function summarizeFileListing(output: string): string | null {
  const files = output.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  if (files.length < 6) return null;
  if (!files.every((file) => /[/.]/.test(file) && !/\s{2,}/.test(file))) return null;

  const areas = new Map<string, number>();
  for (const file of files) {
    const clean = file.replace(/^\.\//, "");
    const parts = clean.split("/");
    const area = parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }

  const topAreas = [...areas.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([area, count]) => `${area} x${count}`);

  return [
    `${files.length} files; areas: ${compactList(topAreas, 5)}`,
  ].join("\n");
}

export function summarizeDiffStat(output: string): string | null {
  const lines = output.trim().split("\n").filter(Boolean);
  const total = [...lines].reverse().find((line) => /\bfiles? changed\b/.test(line));
  if (!total) return null;
  const files = lines.filter((line) => /\s+\|\s+/.test(line)).map((line) => line.split("|")[0].trim());
  return [`Diff: ${total.trim()}`, files.length ? `Files: ${compactList(files, 8)}` : ""].filter(Boolean).join("\n");
}

export function formatProjectOverview(pkg: { name?: string; version?: string; scripts?: Record<string, unknown>; dependencies?: Record<string, unknown> } | null, sourceEntries: string[]): string {
  const lines: string[] = [];
  if (pkg?.name) lines.push(`${pkg.name}@${pkg.version ?? "0.0.0"}`);

  const scripts = Object.keys(pkg?.scripts ?? {});
  if (scripts.length > 0) lines.push(`Scripts (${scripts.length}): ${compactList(scripts, 12)}`);

  const deps = Object.keys(pkg?.dependencies ?? {});
  if (deps.length > 0) lines.push(`Deps (${deps.length}): ${compactList(deps, 12)}`);

  if (sourceEntries.length > 0) lines.push(`Source (${sourceEntries.length}): ${compactList(sourceEntries, 12)}`);
  return lines.join("\n");
}
