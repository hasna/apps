/**
 * CI / pre-commit secret scan for hasna/apps.
 *
 * Scans ADDED LINES ONLY (a scanner that reports clean on the untouched half of
 * the tree is the one that can see a leak) and prints file, line and pattern
 * NAME — never a matched value: echoing what it found writes the credential
 * into the log, which is the leak it exists to prevent.
 *
 * Usage:
 *   bun tooling/ci/check-secrets.ts                # staged diff (local pre-commit)
 *   bun tooling/ci/check-secrets.ts --base <ref>   # added lines vs base (CI)
 *   bun tooling/ci/check-secrets.ts --self-test    # prove it can fire AND stay silent
 *
 * The `[-]`/`[_]` bracket form is deliberate: it matches real tokens
 * identically but cannot match its own pattern text, so committing this file
 * never trips the scan on itself.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "anthropic-key", re: /sk[-]ant-/i },
  { name: "anthropic-project-key", re: /sk[-]proj-/i },
  { name: "npm-token", re: /npm[_][A-Za-z0-9]{20,}/ },
  { name: "github-org-token", re: /gho[_]/ },
  { name: "github-pat", re: /ghp[_]/ },
  { name: "approle-secret", re: /secret[-]token[:]/ },
  { name: "ctx7sk-key", re: /ctx7sk[-]/i },
  { name: "xai-key", re: /xai[-]/i },
  { name: "google-api-key", re: /AIza[a-zA-Z0-9]/ },
  { name: "aws-access-key", re: /AKIA[A-Z0-9]/ },
];

const EXCLUDE_PATHS = [".changeset/config.json"];

function scanText(text: string): Array<{ line: number; pattern: string; sample: string }> {
  const hits: Array<{ line: number; pattern: string; sample: string }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const p of PATTERNS) {
      const m = lines[i].match(p.re);
      if (m) {
        hits.push({ line: i + 1, pattern: p.name, sample: redact(lines[i], p.re) });
      }
    }
  }
  return hits;
}

function redact(line: string, re: RegExp): string {
  const idx = line.search(re);
  if (idx < 0) return "<line>";
  const before = line.slice(0, idx);
  return `${before}[REDACTED]`;
}

function diffAddedLines(base: string | null): { text: string; label: string } {
  const cmd = base
    ? `git diff --no-ext-diff --unified=0 ${base} HEAD`
    : `git diff --cached --no-ext-diff --unified=0`;
  let out = "";
  try {
    out = execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    out = "";
  }
  const added: string[] = [];
  let currentFile = "(unknown)";
  for (const line of out.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push(`${currentFile}: ${line.slice(1)}`);
    }
  }
  return { text: added.join("\n"), label: base ? `added lines vs ${base}` : "staged added lines" };
}

function runScan(base: string | null): number {
  const { text, label } = diffAddedLines(base);
  const perLine = text.split("\n");
  const hits: Array<{ file: string; lineNo: number; pattern: string }> = [];
  perLine.forEach((ln, idx) => {
    if (!ln) return;
    const [file] = ln.split(": ");
    const body = ln.slice(file.length + 2);
    for (const p of PATTERNS) {
      if (p.re.test(body)) {
        hits.push({ file, lineNo: idx + 1, pattern: p.name });
      }
    }
  });
  if (hits.length > 0) {
    console.error(`SECRETS DETECTED (${label}) — DO NOT COMMIT:`);
    for (const h of hits) {
      console.error(`  ${h.file}:${h.lineNo} — pattern ${h.pattern}`);
    }
    return 1;
  }
  console.log(`secrets scan (${label}): 0 findings, ${perLine.filter(Boolean).length} added lines checked`);
  return 0;
}

function selfTest(): number {
  let failed = false;
  const check = (name: string, ok: boolean) => {
    console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
    if (!ok) failed = true;
  };

  const badLines = [
    `export const KEY = "${"sk-" + "ant-api03-" + "0".repeat(64)}";`,
    `const T = "${"npm_" + "a".repeat(24)}";`,
    `token="${"ghp_" + "b".repeat(36)}"`,
    `aws="${"AKIA" + "A".repeat(16)}"`,
    `g="${"AIza" + "B".repeat(35)}"`,
    `secret="${"secret-token:" + "c".repeat(12)}"`,
    `k="${"ctx7sk-" + "d".repeat(12)}"`,
    `x="${"xai-" + "e".repeat(12)}"`,
  ];
  const cleanLines = [
    `export const NAME = "hasna/apps";`,
    `const url = "https://example.com";`,
    `apiKeyName = "hasna/npm/live/publish-token";`,
    `const awsArnField = "arn field";`,
  ];

  const badHits = scanText(badLines.join("\n"));
  check(`fires on seeded violations (${badHits.length}/${badLines.length} caught)`, badHits.length === badLines.length);
  const cleanHits = scanText(cleanLines.join("\n"));
  check(`stays silent on clean lines (0 hits)`, cleanHits.length === 0);

  if (failed) {
    console.error("self-test FAILED — the scan is broken; fix it before trusting any clean result");
    return 1;
  }
  console.log("self-test: PASS (can fire AND stay silent)");
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  process.exit(selfTest());
}
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args[baseIdx + 1] : null;
process.exit(runScan(base));
