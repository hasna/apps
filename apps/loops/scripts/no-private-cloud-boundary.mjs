#!/usr/bin/env bun
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const skippedDirs = new Set([".git", ".hasna", ".bun-cache", ".tmp", "node_modules"]);
const skippedFiles = new Set([".project.json"]);
const scannedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".lock",
]);
const scannedExtensionlessFiles = new Set(["LICENSE"]);

const privatePackageScope = ["@hasna", "tools"].join("");
const privatePackageName = ["platform", "loops"].join("-");
const privateHostedDomainSuffix = ["hasna", "xyz"].join(".");
const disallowedLiterals = [
  `${privatePackageScope}/${privatePackageName}`,
  ["@hasna", "xyz"].join("") + `/${privatePackageName}`,
  privatePackageName,
  ["loops", "hasnatools"].join("."),
  ["openloops", "hasnatools"].join("."),
];
const escapedPrivateHostedDomainSuffix = privateHostedDomainSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const privateHostedDomainPattern = new RegExp(
  `(?:^|[^a-z0-9-])(?:[a-z0-9-]+\\.)*${escapedPrivateHostedDomainSuffix}(?=$|[^a-z0-9.-]|\\.(?:$|[^a-z0-9-]))`,
  "i",
);
const unicodeDotEquivalentPattern = /[\u3002\uff0e\uff61]/g;
const percentEncodedBytesPattern = /(?:%[0-9a-f]{2})+/gi;
const percentEncodedBytePattern = /%([0-9a-f]{2})/gi;
const javascriptCharacterEscapePattern =
  /\\(?:x([0-9a-f]{2})|u([0-9a-f]{4})|u\{([0-9a-f]{1,6})\})/gi;
const maxCanonicalizationPasses = 2;
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

function parseRoot(args) {
  let root = defaultRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--root") {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value) {
      throw new Error("--root requires a path");
    }
    root = resolve(value);
    index += 1;
  }
  return root;
}

const root = parseRoot(process.argv.slice(2));

function decodePercentEncodedBytes(text) {
  return text.replace(percentEncodedBytesPattern, (encodedBytes) => {
    try {
      return decodeURIComponent(encodedBytes);
    } catch {
      return encodedBytes.replace(percentEncodedBytePattern, (encodedByte, hex) => {
        const value = Number.parseInt(hex, 16);
        return value <= 0x7f ? String.fromCodePoint(value) : encodedByte;
      });
    }
  });
}

function decodeJavascriptCharacterEscapes(text) {
  return text.replace(
    javascriptCharacterEscapePattern,
    (escape, hexByte, hexCodeUnit, hexCodePoint) => {
      const hex = hexByte ?? hexCodeUnit ?? hexCodePoint;
      const value = Number.parseInt(hex, 16);
      if (!Number.isFinite(value) || value > 0x10ffff) return escape;
      return String.fromCodePoint(value);
    },
  );
}

function normalizeHostedDomainText(text) {
  let normalized = text;
  for (let pass = 0; pass < maxCanonicalizationPasses; pass += 1) {
    const next = decodePercentEncodedBytes(
      decodeJavascriptCharacterEscapes(normalized),
    )
      .normalize("NFKC")
      .replace(unicodeDotEquivalentPattern, ".");
    if (next === normalized) break;
    normalized = next;
  }
  return normalized;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;
    if (skippedFiles.has(entry)) continue;
    const path = join(dir, entry);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      yield* walk(path);
    } else if (
      stat.isFile() &&
      (scannedExtensions.has(extname(path)) || scannedExtensionlessFiles.has(basename(path)))
    ) {
      yield path;
    }
  }
}

const findings = [];
for (const path of walk(root)) {
  const rel = relative(root, path).split(sep).join("/");
  const isTestFile = /\.test\.[cm]?[jt]s$/.test(rel);
  const text = readFileSync(path, "utf8");
  const normalizedHostedDomainText = normalizeHostedDomainText(text);
  if (privateHostedDomainPattern.test(normalizedHostedDomainText)) {
    findings.push(`${rel}: internal hosted domain suffix`);
  }
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
