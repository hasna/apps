import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const legacyBrand = ["Open", "Loops"].join("");
const scannerFiles = new Set([
  "scripts/check-branding.mjs",
  "scripts/check-branding.test.mjs",
]);
const preservedFiles = new Set([
  "migrations/0010_tenant_enforce.sql",
]);
const preservedLines = new Map([
  ["CHANGELOG.md", new Set([
    `  \`no such column: claim_token\` on machines that already had active ${legacyBrand}`,
    `Self-hosted runtime MVP release for operator-owned ${legacyBrand} control planes.`,
    `- 0.3.3 (2026-06-20) fix: harden ${legacyBrand} daemon ownership and redaction`,
    `- feat: build ${legacyBrand} CLI daemon`,
  ])],
  ["src/lib/storage/postgres-schema.ts", new Set([
    `      RAISE EXCEPTION 'reserved ${legacyBrand} database role % is LOGIN; detach or replace that credential with provider authority before tenant enforcement',`,
    `    RAISE EXCEPTION 'reserved ${legacyBrand} role % has a dependency in database %; use a dedicated cluster or remove the cross-database dependency before tenant enforcement',`,
    `    RAISE EXCEPTION 'reserved ${legacyBrand} role % owns database %; role names must be exclusive to the dedicated ${legacyBrand} cluster',`,
    `    RAISE EXCEPTION 'tenant enforcement bootstrap login must be distinct from ${legacyBrand} database roles';`,
    `    RAISE EXCEPTION 'tenant enforcement did not normalize ${legacyBrand} database roles';`,
    `    RAISE EXCEPTION 'tenant enforcement left unexpected function privileges outside the ${legacyBrand} auth surface';`,
  ])],
  ["src/serve/index.test.ts", new Set([
    `    expect(statements[roleCreate]).toContain("reserved ${legacyBrand} database role % is LOGIN");`,
  ])],
]);

const productNoun = "(?:app|product|brand|runtime|scheduler|daemon|cli|api|mcp|service|control[- ]plane|workflow(?:s)?|loop(?:s)?|package|tool|engine)";
const productVerb = "(?:is|are|can|has|supports|ships|owns|must|may|will|does|records|executes|requires)";
const lowerDisplayContext = new RegExp(`\\b(?:openloops|open-loops)\\s+(?:${productNoun}|${productVerb})\\b`, "i");

export function legacyBrandReason(line) {
  if (/OpenLoops/.test(line)) return "legacy-camel-brand";
  if (/\bOpenloops\b/.test(line)) return "legacy-title-brand";
  if (/\bOPENLOOPS\b/.test(line)) return "legacy-uppercase-brand";
  if (/\bOpen[ -]Loops\b/.test(line)) return "legacy-separated-brand";
  if (/\bopen loops\b/i.test(line)) return "legacy-spaced-brand";
  if (/^\s*#{1,6}\s+open-?loops\b/i.test(line)) return "legacy-heading-brand";
  if (/\[(?:openloops|open-loops)\]/i.test(line)) return "legacy-log-brand";
  if (/\bBUG:\s+(?:openloops|open-loops)\b/i.test(line)) return "legacy-task-brand";
  if (/\b(?:upgrade|install|launch|start|stop|restart)\s+(?:openloops|open-loops)\b/i.test(line)) return "legacy-action-brand";
  if (lowerDisplayContext.test(line)) return "legacy-context-brand";
  return undefined;
}

export function scanTrackedFiles(cwd = process.cwd()) {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const violations = [];

  for (const file of trackedFiles) {
    if (scannerFiles.has(file) || preservedFiles.has(file)) continue;

    const contents = readFileSync(`${cwd}/${file}`);
    const lines = contents.toString("utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (preservedLines.get(file)?.has(line)) continue;
      const reason = legacyBrandReason(line);
      if (reason) violations.push(`${file}:${index + 1}:${reason}`);
    }
  }

  return violations;
}

if (import.meta.main) {
  const violations = scanTrackedFiles();
  if (violations.length > 0) {
    console.error(`Legacy product branding found outside preserved compatibility/provenance surfaces:\n${violations.join("\n")}`);
    process.exit(1);
  }

  console.log("Loops branding check passed");
}
