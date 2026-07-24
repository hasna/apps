#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

type Finding = {
  path: string;
  line: number;
  rule: string;
  detail: string;
};

const LOCKFILE_NAMES = new Set([
  "bun.lock",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const TOKEN_PATTERNS: Array<{ re: RegExp; rule: string; detail: string }> = [
  { re: /npm_[A-Za-z0-9]{36,}/, rule: "literal-npm-token", detail: "literal npm token-like value" },
  { re: /gh[pousr]_[A-Za-z0-9_]{36,}/, rule: "literal-github-token", detail: "literal GitHub token-like value" },
  { re: /sk-ant-[A-Za-z0-9\-_]{40,}/, rule: "literal-anthropic-key", detail: "literal Anthropic key-like value" },
  { re: /sk-[A-Za-z0-9]{48,}/, rule: "literal-openai-key", detail: "literal OpenAI key-like value" },
  { re: /AKIA[0-9A-Z]{16}/, rule: "literal-aws-access-key", detail: "literal AWS access-key-like value" },
];

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split("\0").filter(Boolean);
}

function shouldScan(path: string): boolean {
  const name = basename(path);
  return isNpmrcName(name) || name === "bunfig.toml" || name === ".bunfig.toml" || LOCKFILE_NAMES.has(name);
}

function isNpmrcName(name: string): boolean {
  return name === ".npmrc" || name.startsWith(".npmrc.") || name.endsWith(".npmrc");
}

function readText(path: string): string | null {
  const buf = readFileSync(path);
  if (buf.includes(0)) return null;
  return buf.toString("utf-8");
}

function isSafeReference(value: string): boolean {
  const trimmed = value.replace(/^['"]|['"]$/g, "");
  return (
    /^\$\{[A-Z][A-Z0-9_]*\}$/.test(trimmed) ||
    /^\$[A-Z][A-Z0-9_]*$/.test(trimmed) ||
    /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(trimmed) ||
    /^%[A-Z][A-Z0-9_]*%$/.test(trimmed)
  );
}

function scanNpmrc(path: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const auth = line.match(/(?:^|:)(_[A-Za-z]*(?:auth|password)[A-Za-z]*|password)\s*=\s*(.+)$/i);
    if (auth) {
      const value = auth[2]!.replace(/\s[#;].*$/, "").trim();
      if (value && !isSafeReference(value)) {
        findings.push({
          path,
          line: i + 1,
          rule: "npmrc-literal-auth",
          detail: "tracked npm auth entry uses a literal value",
        });
      }
    }
    findings.push(...scanCredentialedUrl(path, i + 1, line));
    findings.push(...scanTokenPatterns(path, i + 1, line));
  }
  return findings;
}

function scanBunConfig(path: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  let inReleaseAgeExcludes = false;
  let hasMinimumReleaseAge = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) continue;
    const releaseAge = line.match(/^minimumReleaseAge\s*=\s*(?:"([^"]+)"|'([^']+)'|([0-9]+))\s*(?:#.*)?$/i);
    if (releaseAge) {
      hasMinimumReleaseAge = true;
      const rawValue = releaseAge[1] ?? releaseAge[2] ?? releaseAge[3] ?? "";
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value <= 0) {
        findings.push({
          path,
          line: i + 1,
          rule: "bun-release-age-disabled",
          detail: "Bun release-age quarantine is disabled",
        });
      }
    }
    const startsReleaseAgeExcludes = /minimumReleaseAgeExcludes/i.test(line);
    if (startsReleaseAgeExcludes || inReleaseAgeExcludes) {
      for (const match of line.matchAll(/["']([^"']+)["']/g)) {
        const item = match[1]!;
        if (!isExactHasnaPackageName(item)) {
          findings.push({
            path,
            line: i + 1,
            rule: "bun-release-age-broad-exclude",
            detail: "Bun release-age exclude must be an exact @hasna package name",
          });
        }
      }
    }
    inReleaseAgeExcludes = startsReleaseAgeExcludes
      ? line.includes("[") && !line.includes("]")
      : inReleaseAgeExcludes && !line.includes("]");
    findings.push(...scanTokenPatterns(path, i + 1, line));
  }
  if (!hasMinimumReleaseAge) {
    findings.push({
      path,
      line: 1,
      rule: "bun-release-age-missing",
      detail: "Bun release-age quarantine must be configured with a positive minimumReleaseAge",
    });
  }
  return findings;
}

function scanCredentialedUrl(path: string, line: number, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/([^/\s#;]+)@/gi)) {
    const userInfo = match[1]!;
    const password = userInfo.includes(":") ? userInfo.split(":").slice(1).join(":") : userInfo;
    if (password && !isSafeReference(password)) {
      findings.push({
        path,
        line,
        rule: "package-manager-url-credentials",
        detail: "package-manager URL embeds literal credentials",
      });
    }
  }
  return findings;
}

function scanTokenPatterns(path: string, line: number, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const pattern of TOKEN_PATTERNS) {
    if (pattern.re.test(text)) {
      findings.push({ path, line, rule: pattern.rule, detail: pattern.detail });
    }
  }
  return findings;
}

function isExactHasnaPackageName(item: string): boolean {
  return /^@hasna\/[a-z0-9][a-z0-9._-]*$/.test(item);
}

const findings: Finding[] = [];
let scanned = 0;
for (const path of trackedFiles().filter(shouldScan)) {
  const text = readText(path);
  if (text === null) continue;
  scanned++;
  const lines = text.split(/\r?\n/);
  if (isNpmrcName(basename(path))) findings.push(...scanNpmrc(path, lines));
  else if (basename(path) === "bunfig.toml" || basename(path) === ".bunfig.toml") findings.push(...scanBunConfig(path, lines));
  else findings.push(...lines.flatMap((line, index) => scanTokenPatterns(path, index + 1, line)));
}

if (findings.length === 0) {
  console.log(`Package-manager secret guard clean (${scanned} tracked file(s) scanned).`);
  process.exit(0);
}

console.error(`${findings.length} package-manager secret finding(s) detected.`);
for (const finding of findings.slice(0, 50)) {
  console.error(`${finding.path}:${finding.line} ${finding.rule} - ${finding.detail}`);
}
if (findings.length > 50) {
  console.error(`Omitted ${findings.length - 50} finding(s).`);
}
console.error("Secret values are never printed by this guard.");
process.exit(1);
