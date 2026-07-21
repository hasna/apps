import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const legacyBrand = ["Open", "Loops"].join("");
const legacyTitleBrand = ["Open", "loops"].join("");
const legacyUpperBrand = ["OPEN", "LOOPS"].join("");
const legacySpacedBrand = ["open", "loops"].join(" ");
const lowerLegacySolid = ["open", "loops"].join("");
const lowerLegacyHyphenated = ["open", "loops"].join("-");
const tenantEnforcementLegacyLines = new Set([
  `      RAISE EXCEPTION 'reserved ${legacyBrand} database role % is LOGIN; detach or replace that credential with provider authority before tenant enforcement',`,
  `    RAISE EXCEPTION 'reserved ${legacyBrand} role % has a dependency in database %; use a dedicated cluster or remove the cross-database dependency before tenant enforcement',`,
  `    RAISE EXCEPTION 'reserved ${legacyBrand} role % owns database %; role names must be exclusive to the dedicated ${legacyBrand} cluster',`,
  `    RAISE EXCEPTION 'tenant enforcement bootstrap login must be distinct from ${legacyBrand} database roles';`,
  `    RAISE EXCEPTION 'tenant enforcement did not normalize ${legacyBrand} database roles';`,
  `    RAISE EXCEPTION 'tenant enforcement left unexpected function privileges outside the ${legacyBrand} auth surface';`,
]);
const sharedKitHistoricalLines = new Set([
  `remain the 2026-07-07 inventory. ${legacyBrand} state normalization landed through`,
  `1. Treat ${legacyBrand} normalization as complete: version \`0.5.1\` state`,
  `approval. ${legacyBrand} normalization is complete: version \`0.5.1\` state`,
  `- For the current ${legacyBrand} checkout: \`bun run check:contracts\`.`,
  `- For ${legacyBrand}: \`bun run typecheck\`, \`bun test src/lib/storage/*.test.ts\`,`,
  `- ${legacyBrand} generated storage-kit normalization is complete. Version \`0.5.1\``,
  `- ${legacyBrand} route-event migration.`,
  `1. ${legacyBrand} storage-kit normalization.`,
  `3. Events compatibility inventory for ${legacyBrand} route aliases.`,
]);
const preservedLines = new Map([
  ["CHANGELOG.md", new Set([
    `  \`no such column: claim_token\` on machines that already had active ${legacyBrand}`,
    `Self-hosted runtime MVP release for operator-owned ${legacyBrand} control planes.`,
    `- 0.3.3 (2026-06-20) fix: harden ${legacyBrand} daemon ownership and redaction`,
    `- feat: build ${legacyBrand} CLI daemon`,
  ])],
  ["docs/SHARED_KIT_EXTRACTION_INVENTORY.md", sharedKitHistoricalLines],
  ["migrations/0010_tenant_enforce.sql", tenantEnforcementLegacyLines],
  ["src/lib/storage/postgres-schema.ts", tenantEnforcementLegacyLines],
  ["src/serve/index.test.ts", new Set([
    `    expect(statements[roleCreate]).toContain("reserved ${legacyBrand} database role % is LOGIN");`,
  ])],
  ["src/serve/index.ts", new Set([
    `      error.message.startsWith("reserved ${legacyBrand} database role") ||`,
    `      error.message.startsWith("reserved ${legacyBrand} role") ||`,
    `  if (message.startsWith("reserved ${legacyBrand} database role")) {`,
    `  if (message.startsWith("reserved ${legacyBrand} role")) {`,
  ])],
  ["src/lib/storage/postgres-loop-storage.test.ts", new Set([
    `    expect(loginRoleBootstrap.errorMessage).toContain("reserved ${legacyBrand} database role open_loops_runtime is LOGIN");`,
  ])],
]);

const lowerBrand = `(?:${lowerLegacySolid}|${lowerLegacyHyphenated})`;
const productNoun = "(?:app|product|project|brand|runtime|scheduler|daemon|cli|api|mcp|service|control[- ]plane|workflow(?:s)?|loop(?:s)?|package|tool|engine|experience|documentation)";
const productVerb = "(?:is|are|can|has|supports|ships|owns|must|may|will|does|records|executes|requires)";
const lowerDisplayContext = new RegExp(`\\b${lowerBrand}\\s+(?:${productNoun}|${productVerb})\\b`, "i");
const lowerDisplayLead = new RegExp(`\\b(?:powered\\s+by|built\\s+with|use|using|choose|try|welcome\\s+to|read\\s+the)\\s+${lowerBrand}\\b`, "i");
const lowerDisplaySuffix = new RegExp(`\\b${lowerBrand}(?:['’]s?|-(?:powered|based|managed|native))`, "i");
const legacyCamelPattern = new RegExp(legacyBrand);
const legacyTitlePattern = new RegExp(`\\b${legacyTitleBrand}\\b`);
const legacyUpperPattern = new RegExp(`\\b${legacyUpperBrand}\\b`);
const legacySpacedPattern = new RegExp(`\\b${legacySpacedBrand}\\b`, "i");
const legacyHeadingPattern = new RegExp(`^\\s*#{1,6}\\s+(?:about\\s+)?${lowerBrand}\\b`, "i");

export function legacyBrandReason(line) {
  if (legacyCamelPattern.test(line)) return "legacy-camel-brand";
  if (legacyTitlePattern.test(line)) return "legacy-title-brand";
  if (legacyUpperPattern.test(line)) return "legacy-uppercase-brand";
  if (/\bOpen[ -]Loops\b/.test(line)) return "legacy-separated-brand";
  if (legacySpacedPattern.test(line)) return "legacy-spaced-brand";
  if (legacyHeadingPattern.test(line)) return "legacy-heading-brand";
  if (/\[(?:openloops|open-loops)\]/i.test(line)) return "legacy-log-brand";
  if (/\bBUG:\s+(?:openloops|open-loops)\b/i.test(line)) return "legacy-task-brand";
  if (/\b(?:upgrade|install|launch|start|stop|restart)\s+(?:openloops|open-loops)\b/i.test(line)) return "legacy-action-brand";
  if (lowerDisplayLead.test(line)) return "legacy-leading-context-brand";
  if (lowerDisplaySuffix.test(line)) return "legacy-possessive-or-suffix-brand";
  if (lowerDisplayContext.test(line)) return "legacy-context-brand";
  return undefined;
}

export function scanTrackedFiles(cwd = process.cwd()) {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const violations = [];

  for (const file of trackedFiles) {
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
