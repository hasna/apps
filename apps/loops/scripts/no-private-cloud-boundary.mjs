#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const skippedDirs = new Set([".git", ".hasna", ".bun-cache", ".tmp", "node_modules"]);
const skippedFiles = new Set([".project.json"]);
const scannedExtensions = new Set([".ts", ".js", ".json", ".md", ".yml", ".yaml", ".toml", ".lock"]);

const privatePackageScope = ["@hasna", "tools"].join("");
const privatePackageName = ["platform", "loops"].join("-");
const disallowedLiterals = [
  `${privatePackageScope}/${privatePackageName}`,
  ["@hasna", "xyz"].join("") + `/${privatePackageName}`,
  privatePackageName,
  ["loops", "hasnatools"].join("."),
  ["openloops", "hasnatools"].join("."),
];
const localHomePath = ["/home", "hasna"].join("/");
const disallowedPublicPathLiterals = [
  localHomePath,
  [localHomePath, "workspace", "hasna", "opensource"].join("/"),
  [localHomePath, ".hasna", "loops"].join("/"),
];

const secretPatterns = [
  { id: "openai-project-key", pattern: new RegExp(["sk", "-proj-[A-Za-z0-9_-]{8,}"].join("")) },
  { id: "anthropic-key", pattern: new RegExp(["sk", "-ant-[A-Za-z0-9_-]{8,}"].join("")) },
  { id: "npm-token", pattern: new RegExp(["npm", "_[A-Za-z0-9]{16,}"].join("")) },
  { id: "github-token", pattern: new RegExp(["gh", "[op]_[A-Za-z0-9]{16,}"].join("")) },
  { id: "github-fine-grained-token", pattern: new RegExp(["github", "_pat_[A-Za-z0-9_]{20,}"].join("")) },
  { id: "slack-token", pattern: new RegExp(["xox", "[abprs]-[A-Za-z0-9-]{16,}"].join("")) },
  { id: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "authorization-bearer", pattern: /authorization:\s*bearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { id: "google-api-key", pattern: new RegExp(["AI", "za[A-Za-z0-9_-]{16,}"].join("")) },
  { id: "aws-access-key", pattern: new RegExp(["AK", "IA[A-Z0-9]{16}"].join("")) },
  { id: "xai-key", pattern: new RegExp(["x", "ai-[A-Za-z0-9_-]{16,}"].join("")) },
  { id: "secret-token-field", pattern: new RegExp(["secret", "-token:\\s*[A-Za-z0-9._~+/=-]{16,}"].join(""), "i") },
  { id: "generic-credential-assignment", pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{16,}["']/i },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    if (skippedFiles.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else if (stat.isFile() && scannedExtensions.has(extname(path))) {
      yield path;
    }
  }
}

const findings = [];
for (const path of walk(root)) {
  const rel = relative(root, path);
  const isTestFile = /\.test\.[cm]?[jt]s$/.test(rel);
  const text = readFileSync(path, "utf8");
  for (const literal of disallowedLiterals) {
    if (text.includes(literal)) findings.push(`${rel}: private cloud boundary literal "${literal}"`);
  }
  if (!isTestFile) {
    for (const literal of disallowedPublicPathLiterals) {
      if (text.includes(literal)) findings.push(`${rel}: Hasna-local path literal "${literal}"`);
    }
  }
  if (!isTestFile) {
    for (const { id, pattern } of secretPatterns) {
      if (pattern.test(text)) findings.push(`${rel}: possible secret pattern ${id}`);
    }
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}

console.log("OpenLoops private cloud boundary scan passed");
