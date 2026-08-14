#!/usr/bin/env bun
/**
 * Capture a static frame of the domains interactive TUI for docs/screenshots.
 * Usage: bun run scripts/capture-tui-screenshot.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { App } from "../src/cli/tui/App.js";
import { createDomain } from "../src/db/domains.js";
import { closeDatabase } from "../src/db/database.js";
import { stripAnsi } from "../src/cli/tui/format.js";

const tempDir = mkdtempSync(join(tmpdir(), "domains-tui-shot-"));
process.env["DOMAINS_DIR"] = tempDir;

createDomain({
  name: "hasna.com",
  registrar: "Route53",
  status: "active",
  expires_at: "2027-01-15T00:00:00Z",
  ssl_issuer: "Let's Encrypt",
  ssl_expires_at: "2026-09-01T00:00:00Z",
});
createDomain({
  name: "example.io",
  registrar: "Namecheap",
  status: "offered",
  is_premium: true,
  premium_price: 2500,
});
createDomain({
  name: "legacy.net",
  registrar: "GoDaddy",
  status: "expired",
  expires_at: "2024-06-01T00:00:00Z",
});

const { lastFrame } = render(React.createElement(App));
const frame = stripAnsi(lastFrame() ?? "");

const outDir = join(import.meta.dir, "..", ".implementation");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "domains-interactive-screenshot.txt");
writeFileSync(outPath, frame, "utf8");

closeDatabase();

console.log(`Saved TUI frame to ${outPath}`);
console.log(frame);
