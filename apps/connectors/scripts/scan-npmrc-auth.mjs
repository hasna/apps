#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SAFE_NPM_TOKEN_REF = "$" + "{NPM_TOKEN}";
const NPM_CREDENTIAL_KEYS = new Set(["_authToken", "_auth", "_password"]);

export function isAllowedNpmTokenValue(value) {
  return value.trim() === SAFE_NPM_TOKEN_REF;
}

function normalizeCredentialKey(key) {
  const normalized = key.toLowerCase();
  if (normalized === "_authtoken") {
    return "_authToken";
  }
  if (normalized === "_auth") {
    return "_auth";
  }
  if (normalized === "_password") {
    return "_password";
  }
  return key;
}

function isAllowedCredential(key, value) {
  return key === "_authToken" && isAllowedNpmTokenValue(value);
}

export function scanNpmrcText(text, filePath = "<text>") {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    const uncommentedLine = line.replace(/^[#;]\s*/, "");
    const match = uncommentedLine.match(/(?:^|:)\s*(_authToken|_auth|_password)\s*=\s*(.*)$/i);
    if (!match) {
      return;
    }

    const [, rawKey, value] = match;
    const key = normalizeCredentialKey(rawKey);
    if (NPM_CREDENTIAL_KEYS.has(key) && !isAllowedCredential(key, value)) {
      findings.push({ filePath, line: index + 1, key });
    }
  });

  return findings;
}

function trackedNpmrcFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*npmrc*"], {
    encoding: "utf8",
  });
  return [...new Set(output.split(/\r?\n/).filter(Boolean))]
    .filter((filePath) => filePath.endsWith("/.npmrc") || filePath.endsWith("/.npmrc.example") || filePath === ".npmrc" || filePath === ".npmrc.example")
    .filter((filePath) => existsSync(filePath));
}

function moveToRepositoryRoot() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  process.chdir(root);
}

export function scanNpmrcFiles(files) {
  return files.flatMap((filePath) => {
    const text = readFileSync(filePath, "utf8");
    return scanNpmrcText(text, filePath);
  });
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    moveToRepositoryRoot();
  }
  const targets = files.length > 0 ? files : trackedNpmrcFiles();
  const findings = scanNpmrcFiles(targets);

  if (findings.length > 0) {
    console.error("Unsafe npm auth token entries found:");
    for (const finding of findings) {
      console.error(`- ${finding.filePath}:${finding.line} uses unsafe ${finding.key} credentials`);
    }
    process.exit(1);
  }

  console.log(`Scanned ${targets.length} npmrc file(s); no literal npm auth tokens found.`);
}
