#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------
// Deployment resource identifiers.
//
// Credentials are not the only thing that must not ship from a public package.
// A production resource NAME is not a secret in the credential sense — it grants
// nothing on its own — but it is unearned reconnaissance: it tells a reader
// which resources exist, what they are called, and, once the naming convention
// is published alongside a worked example, what every sibling resource is called
// too. That last part is why the convention is treated as in-scope rather than
// as documentation: publishing the pattern is a broader disclosure than
// publishing any single name.
// ---------------------------------------------------------------------------

// Environment segments of the house `<workload>-<env>-<component>` convention.
//
// Deliberately NOT `dev`, `test`, `stage` or `qa`. Those are ordinary English
// and ordinary package-name fragments: including them took a repo-wide trial
// from 19 true findings to 67 matches across 30 files, whose false positives
// were a connector directory literally named `trigger-dev-api-platform`, a
// third-party model identifier carrying a `-preview-` segment, and API-key test
// fixtures. A guard that fires on correct code teaches everyone to ignore it,
// so the environment set is restricted to tokens that carry deployment meaning.
const DEPLOYMENT_ENV_SEGMENT = "prod|production|staging|preview|live|sandbox";

// A resource name built from that convention. `{name}` and `<name>` are allowed
// inside a segment so a documented TEMPLATE is caught as well as a concrete
// name — see the note above on why the pattern itself is in scope.
const DEPLOYMENT_RESOURCE_NAME = new RegExp(
  `(?<![A-Za-z0-9_.-])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:${DEPLOYMENT_ENV_SEGMENT})-[a-z0-9{}<>]+(?:-[a-z0-9{}<>]+)*(?![A-Za-z0-9-])`,
);

// The second, INDEPENDENT signal, and the reason this rule is usable at all.
//
// On its own the name pattern is purely lexical and fires on any third-party
// string that happens to contain an environment-looking segment. Requiring a
// resource-kind word on the same line is what separates "this looks like our
// convention" from "this is being published as the name of a deployed
// resource". Measured over the whole tree, the conjunction reports the real
// exposure and nothing else; the name pattern alone does not.
const INFRA_KIND =
  /(?:(?<![A-Za-z0-9_])(?:ec2|rds|s3|ebs|efs|elb|alb|nlb|vpc|ami|eip|ecs|eks|cloudfront|route53|instance|bucket|database|db_?host|ssh_?host|host|endpoint)(?![A-Za-z0-9])|s3:\/\/)/i;

// Provider-ASSIGNED identifiers. These formats are unambiguous, so unlike the
// convention-derived names above they need no second signal — nothing else in a
// source tree looks like them.
const PROVIDER_RESOURCE_ID: Array<{ re: RegExp; rule: string; detail: string }> = [
  {
    re: /\barn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:\d{12}:/,
    rule: "cloud-resource-arn",
    detail: "cloud resource ARN (embeds the owning account id)",
  },
  {
    re: /(?<![A-Za-z0-9])(?:i|vol|vpc|subnet|sg|ami|eni|snap|igw|rtb|acl)-(?:[0-9a-f]{8}|[0-9a-f]{17})(?![A-Za-z0-9])/,
    rule: "cloud-resource-id",
    detail: "provider-assigned infrastructure resource id",
  },
  {
    re: /\b[a-z0-9-]+\.[a-z0-9]{12,}\.[a-z0-9-]+\.rds\.amazonaws\.com\b/i,
    rule: "managed-database-endpoint",
    detail: "managed database endpoint hostname",
  },
  {
    re: /\b[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com\b/i,
    rule: "object-storage-endpoint",
    detail: "object-storage endpoint hostname",
  },
];

// Extensions we will not even try to read. The null-byte check in readText is
// the real backstop; this is only there to keep the widened scan cheap.
const NON_TEXT_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".tiff",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".mp3", ".mp4", ".mov", ".avi", ".webm", ".wav", ".ogg",
  ".wasm", ".node", ".so", ".dylib", ".dll", ".exe", ".class", ".jar",
]);

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split("\0").filter(Boolean);
}

// What npm will actually ship. This is deliberately not `git ls-files`: `files`
// in package.json is an allowlist over the working tree, so it picks up
// untracked build output and per-connector lockfiles that a tracked-only scan
// cannot see — which is exactly where a leaked credential would hide from us.
function packedFiles(): string[] {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf-8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(output) as Array<{ files?: Array<{ path: string }> }>;
  return (parsed[0]?.files ?? []).map((file) => file.path);
}

// Union, so the guard keeps covering tracked files that never ship (CI config,
// scripts) while gaining everything that does.
function filesToScan(): string[] {
  const paths = new Set(trackedFiles());
  try {
    for (const path of packedFiles()) paths.add(path);
  } catch (error) {
    // A guard that silently degrades to a weaker scan is how this class of bug
    // reaches the registry. Fail loudly instead.
    console.error(`Could not enumerate the packed file list: ${String(error)}`);
    process.exit(1);
  }
  return [...paths];
}

// Package-manager files get the npmrc/bunfig/lockfile rules. This is the
// original gate, unchanged.
function isPackageManagerFile(path: string): boolean {
  const name = basename(path);
  return isNpmrcName(name) || name === "bunfig.toml" || name === ".bunfig.toml" || LOCKFILE_NAMES.has(name);
}

// Deployment identifiers are not confined to package-manager files — the five
// files that carried them were .md, .env.example and a Makefile, none of which
// the original gate opened. So this class is scanned across every text file we
// ship or track, and the selection is an extension DENY-list rather than an
// allow-list: an allow-list is how a whole class goes unscanned by construction,
// which is the defect this rule exists to close.
function isCandidateTextFile(path: string): boolean {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return !NON_TEXT_EXTENSIONS.has(ext);
}

function isNpmrcName(name: string): boolean {
  return name === ".npmrc" || name.startsWith(".npmrc.") || name.endsWith(".npmrc");
}

// "symlink" and "absent" are reported separately and never merged. Merging them
// would let a file that genuinely vanished hide inside a benign-looking symlink
// count, and an unexpectedly unreadable file is exactly the thing an operator
// needs to see.
type PathKind = "symlink" | "absent" | "regular" | "other";

function classifyPath(path: string): PathKind {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    // `filesToScan()` unions git's index with npm's packed list, so a path can
    // be listed and still be absent from the working tree.
    return "absent";
  }
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isFile()) return "regular";
  return "other";
}

function readText(path: string): string | null {
  const buf = readFileSync(path);
  if (buf.length > MAX_TEXT_BYTES) return null;
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
    // Token and credentialed-URL rules are NOT duplicated here: scanPaths
    // applies scanLineRules exactly once to every scanned text file.
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
    // Token and credentialed-URL rules are NOT duplicated here: scanPaths
    // applies scanLineRules exactly once to every scanned text file.
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

// Credential-bearing text is not confined to package-manager files. A value
// that survives minification is still a value, and the previous release
// documented a real credential-adjacent leak that existed only in the
// COMPILED bin/index.js (see CHANGELOG 1.4.1). Token and credentialed-URL
// rules therefore run on EVERY scanned text file — source, docs, generated
// bundles alike — while npmrc/bunfig keep their richer format rules.
function scanLineRules(path: string, lines: string[]): Finding[] {
  return lines.flatMap((line, index) => [
    ...scanTokenPatterns(path, index + 1, line),
    ...scanCredentialedUrl(path, index + 1, line),
  ]);
}

export function scanDeploymentIdentifiers(path: string, lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const pattern of PROVIDER_RESOURCE_ID) {
      if (pattern.re.test(line)) {
        findings.push({ path, line: i + 1, rule: pattern.rule, detail: pattern.detail });
      }
    }
    // Both signals required — see the note on INFRA_KIND.
    if (INFRA_KIND.test(line) && DEPLOYMENT_RESOURCE_NAME.test(line)) {
      findings.push({
        path,
        line: i + 1,
        rule: "deployment-resource-name",
        detail: "shipped file names a deployment resource built from the infrastructure naming convention",
      });
    }
  }
  return findings;
}

function isExactHasnaPackageName(item: string): boolean {
  return /^@hasna\/[a-z0-9][a-z0-9._-]*$/.test(item);
}

export type ScanResult = { findings: Finding[]; scanned: number; symlinks: number; absent: number };

export function scanPaths(paths: string[]): ScanResult {
  const findings: Finding[] = [];
  let scanned = 0;
  let symlinks = 0;
  let absent = 0;
  for (const path of paths) {
    const packageManagerFile = isPackageManagerFile(path);
    if (!packageManagerFile && !isCandidateTextFile(path)) continue;
    // A tracked symlink's blob is the target PATH, not file content, so there is
    // nothing here to scan. Skipping is also what keeps the guard inside the
    // repository: this tree contains a committed symlink to an absolute path on
    // a developer's own machine, and following such a link would either crash
    // the guard or read a file that never ships. Counted and reported rather
    // than swallowed — a guard that quietly reads fewer files than you think is
    // the failure this whole script exists to prevent.
    const kind = classifyPath(path);
    if (kind === "symlink" || kind === "other") {
      symlinks++;
      continue;
    }
    if (kind === "absent") {
      absent++;
      continue;
    }
    const text = readText(path);
    if (text === null) continue;
    scanned++;
    const lines = text.split(/\r?\n/);
    if (isNpmrcName(basename(path))) {
      findings.push(...scanNpmrc(path, lines));
    } else if (basename(path) === "bunfig.toml" || basename(path) === ".bunfig.toml") {
      findings.push(...scanBunConfig(path, lines));
    }
    // Token and credentialed-URL rules apply EXACTLY ONCE to every scanned
    // text file — lockfiles, source, docs, generated bundles (bin/, dist/)
    // once the scan runs after the build, and npmrc/bunfig
    // alike. A value that survived bundling or config formatting is still a
    // value. Format-specific checks live in the parsers above.
    findings.push(...scanLineRules(path, lines));
    findings.push(...scanDeploymentIdentifiers(path, lines));
  }
  return { findings, scanned, symlinks, absent };
}

if (import.meta.main) main();

function main(): void {
const { findings, scanned, symlinks, absent } = scanPaths(filesToScan());
const symlinkNote = symlinks > 0 ? `, ${symlinks} symlink(s) skipped` : "";
const absentNote = absent > 0 ? `, ${absent} listed-but-absent path(s) skipped` : "";

// The file census is emitted on BOTH the pass and the fail path, and that is
// deliberate rather than tidiness.
//
// This script's CI step is named "Package-manager secret guard", and that name
// read identically before and after the scan was widened from a basename
// allow-list to the whole text tree. So a green step on a tree that still
// carries an exposure is indistinguishable from a green step on a clean one —
// the step name is not evidence about which guard ran. The only observable that
// changed is how many files were opened: roughly 1,220 under the old
// basename gate against roughly 22,745 now. That number is therefore the sole
// discriminator available to anyone verifying that the widened guard actually
// ran, and it is relied on outside this repository as a release-gate
// corroborator. A discriminator that disappears exactly when the guard fails is
// no use to an operator reading a red log, so it is printed either way.
const census = `${scanned} tracked + packed file(s) scanned${symlinkNote}${absentNote}`;

if (findings.length === 0) {
  console.log(`Package-manager and deployment-identifier guard clean (${census}).`);
  process.exit(0);
}

console.error(`${findings.length} package-manager / deployment-identifier finding(s) detected (${census}).`);
for (const finding of findings.slice(0, 50)) {
  console.error(`${finding.path}:${finding.line} ${finding.rule} - ${finding.detail}`);
}
if (findings.length > 50) {
  console.error(`Omitted ${findings.length - 50} finding(s).`);
}
// Load-bearing: a guard that echoes what it found would itself publish the
// value into CI logs, which are more widely readable than the file was.
console.error("Secret values and resource identifiers are never printed by this guard.");
process.exit(1);
}
