export interface OutputManifest {
  kind: "search" | "files";
  content: string;
}

function compactList(items: string[], limit: number): string {
  const shown = items.slice(0, limit);
  return items.length > limit ? `${shown.join(",")},+${items.length - limit} more` : shown.join(",");
}

function compactRanges(values: string[]): string {
  const numbers = values.map((value) => Number(value)).filter(Number.isFinite).sort((a, b) => a - b);
  const ranges: string[] = [];
  for (let i = 0; i < numbers.length; i++) {
    const start = numbers[i];
    let end = start;
    while (i + 1 < numbers.length && numbers[i + 1] === end + 1) {
      i += 1;
      end = numbers[i];
    }
    ranges.push(end > start ? `${start}-${end}` : String(start));
  }
  return ranges.join(",");
}

function splitCompoundSuffix(filename: string): { stem: string; suffix: string } {
  const suffixes = [
    ".coverage.test.ts",
    ".integrated.test.ts",
    ".full.test.ts",
    ".test.tsx",
    ".test.ts",
    ".spec.tsx",
    ".spec.ts",
    ".tsx",
    ".ts",
    ".js",
    ".sh",
  ];
  const suffix = suffixes.find((item) => filename.endsWith(item));
  return suffix ? { stem: filename.slice(0, -suffix.length), suffix } : { stem: filename, suffix: "" };
}

export function buildSearchManifest(command: string, output: string): OutputManifest | null {
  const lines = output.trim().split("\n").filter(Boolean);
  const matches = lines.map((line) => {
    const match = line.match(/^(.+?):(\d+)(?::\d+)?:([\s\S]*)$/);
    return match ? { file: match[1], line: match[2] } : null;
  }).filter((match): match is { file: string; line: string } => Boolean(match));
  if (matches.length < 2 || matches.length !== lines.length) return null;

  const byFile = new Map<string, string[]>();
  for (const match of matches) byFile.set(match.file, [...(byFile.get(match.file) ?? []), match.line]);

  const parts = [
    `search refs: ${matches.length} matches in ${byFile.size} files`,
  ];
  for (const [file, fileMatches] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(`${file}:${compactRanges(fileMatches)}`);
  }
  return { kind: "search", content: parts.join("\n") };
}

export function buildFileManifest(command: string, output: string): OutputManifest | null {
  const files = output.trim().split("\n").map((line) => line.trim()).filter(Boolean);
  if (files.length < 6) return null;
  if (!files.every((file) => /[/.]/.test(file) && !/\s/.test(file))) return null;

  const byPattern = new Map<string, string[]>();
  for (const file of files) {
    const clean = file.replace(/^\.\//, "");
    const parts = clean.split("/");
    const dir = parts.slice(0, -1).join("/") || ".";
    const basename = parts.at(-1) ?? clean;
    const { stem, suffix } = splitCompoundSuffix(basename);
    const pattern = suffix ? `${dir}/*${suffix}` : dir;
    byPattern.set(pattern, [...(byPattern.get(pattern) ?? []), stem]);
  }

  const parts = [
    `file refs: ${files.length} files in ${byPattern.size} groups`,
  ];
  for (const [pattern, stems] of [...byPattern.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(`${pattern}{${compactList(stems, 80)}}`);
  }
  return { kind: "files", content: parts.join("\n") };
}

export function buildOutputManifest(command: string, output: string): OutputManifest | null {
  return buildSearchManifest(command, output) ?? buildFileManifest(command, output);
}
