import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Publish-guard regression (row 27d2a7a2 class): the packed tarball of
// @hasna/shield must carry no internal-infra strings. Mirrors
// tooling/ci/check-publish-guard.ts: `npm pack --dry-run --json` runs the
// member's prepack (rebuilding dist), then every packed entry's name and
// content is scanned with the guard's pattern set. This test failed before
// the fix (aws-account-id hit from the bundled zod nil-UUID regex in
// dist/mcp/index.js) and passes after (zod externalized in the node builds;
// zod remains a declared runtime dependency).
const member = "shield";
const PACK_TIMEOUT_MS = 1800_000;

const INTERNAL_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "hasna-xyz-domain", re: /[.]hasna[.]xyz/ },
  { name: "aws-arn", re: /arn[:]aws[:]/ },
  { name: "aws-account-id", re: /\b[0-9]{12}\b/ },
  { name: "hasna-internal-org", re: /hasna[-]internal/ },
  { name: "internal-apps", re: /internal[-]apps/ },
  { name: "hasna-internal-scope", re: /@hasna[-]internal/ },
  { name: "internal-platform-account", re: new RegExp("7898" + "77399345") },
];

const MAX_CONTENT_BYTES = 4 * 1024 * 1024;

function extractJsonArraySuffix(raw: string): string {
  let i = raw.length - 1;
  while (i >= 0 && /\s/.test(raw[i])) i--;
  if (i < 0 || raw[i] !== "]") {
    throw new Error("pack output has no JSON array document");
  }
  let depth = 0;
  let inString = false;
  for (; i >= 0; i--) {
    const c = raw[i];
    if (inString) {
      if (c === '"') {
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && raw[j] === "\\"; j--) backslashes++;
        if (backslashes % 2 === 0) inString = false;
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "]") depth++;
    else if (c === "[") {
      depth--;
      if (depth === 0) return raw.slice(i);
    }
  }
  throw new Error("pack output brackets do not balance to a single JSON array");
}

function memberRoot(): string {
  return path.resolve(import.meta.dir, "..");
}

test(
  `@hasna/${member} packed tarball carries no internal-infra strings`,
  () => {
    const root = memberRoot();
    let out: string;
    try {
      out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e: any) {
      throw new Error(
        `npm pack --dry-run --json failed in ${root}:\n${String(e?.stderr ?? e?.message ?? e).slice(-800)}`,
      );
    }
    let doc: any;
    try {
      doc = JSON.parse(out);
    } catch {
      doc = JSON.parse(extractJsonArraySuffix(out));
    }
    const files: Array<{ path?: string }> = doc[0]?.files ?? [];
    if (files.length === 0) {
      throw new Error("pack JSON reports zero files — refusing a vacuous pass");
    }
    const hits: Array<{ entry: string; pattern: string }> = [];
    for (const f of files) {
      const name = f.path ?? "";
      for (const p of INTERNAL_PATTERNS) {
        if (p.re.test(name)) hits.push({ entry: name, pattern: p.name });
      }
      const full = path.join(root, name);
      let buf: Buffer;
      try {
        buf = fs.readFileSync(full);
      } catch {
        continue;
      }
      if (buf.length === 0 || buf.length > MAX_CONTENT_BYTES || buf.includes(0)) continue;
      const text = buf.toString("utf8");
      for (const p of INTERNAL_PATTERNS) {
        if (p.re.test(text)) hits.push({ entry: name, pattern: p.name });
      }
    }
    expect(hits).toEqual([]);
  },
  PACK_TIMEOUT_MS,
);
