import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// Regression for O15-04626: @hasna/prompts 0.3.38 was published from a tree
// that carried the bearer-token gate but NOT the loopback-origin CORS
// carve-out of finding code-prompts-1. The published dist/server bundle had
// zero Access-Control-Allow-Origin headers anywhere, so local browser API use
// against a loopback origin was dead in the released artifact and the
// remediation was incomplete. Measured on the registry tarball:
// PROMPTS_API_CORS_ORIGIN and every CORS marker absent.
//
// This test builds the server bundle exactly as prepack does and asserts the
// COMPLETE hardening is present in the artifact that will ship: the bearer
// gate, the loopback/explicit-origin preflight carve-out, CORS headers on
// responses, and the absence of the former wildcard. It fails on the
// published 0.3.38 bundle and passes on bundles built from this source.
const PACK_TIMEOUT_MS = 600_000;

const REQUIRED_MARKERS = [
  // Bearer-token gate (shipped in 0.3.38; kept asserted so a regression of
  // the gate itself also fails here).
  "PROMPTS_API_TOKEN",
  "Unauthorized",
  // Loopback-origin / explicit-origin preflight carve-out (MISSING from the
  // published 0.3.38 bundle — this is the defect).
  "PROMPTS_API_CORS_ORIGIN",
  "localhost",
  // The bundle carries the origin regex in its escaped form.
  "127\\.0\\.0\\.1",
  // Restricted CORS headers on preflight and data responses (also missing
  // from the published 0.3.38 bundle).
  "Access-Control-Allow-Origin",
  "Access-Control-Allow-Headers",
  "Access-Control-Allow-Methods",
];

const FORBIDDEN_MARKERS = [
  // The old wildcard CORS must never come back.
  "Access-Control-Allow-Origin: *",
  'Access-Control-Allow-Origin":"*',
];

function memberRoot(): string {
  return path.resolve(import.meta.dir, "..");
}

function buildServerBundle(): string {
  const root = memberRoot();
  execFileSync("bun", ["run", "build:server"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bundlePath = path.join(root, "dist", "server", "index.js");
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`server bundle not produced at ${bundlePath}`);
  }
  return fs.readFileSync(bundlePath, "utf8");
}

test(
  "@hasna/prompts server bundle carries the complete code-prompts-1 hardening (REST bearer gate + loopback-origin CORS, no wildcard)",
  () => {
    const bundle = buildServerBundle();
    if (bundle.length === 0) {
      throw new Error("server bundle is empty — refusing a vacuous pass");
    }
    const missing = REQUIRED_MARKERS.filter((m) => !bundle.includes(m));
    expect(missing).toEqual([]);
    const present = FORBIDDEN_MARKERS.filter((m) => bundle.includes(m));
    expect(present).toEqual([]);
  },
  PACK_TIMEOUT_MS,
);
