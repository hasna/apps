import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  legacyBrandReason,
  scanTrackedFiles,
  scanTrackedIdentityTokens,
} from "./check-branding.mjs";

describe("Loops branding guard", () => {
  const legacyCamelBrand = ["Open", "Loops"].join("");
  const legacyTitleBrand = ["Open", "loops"].join("");
  const legacyUpperBrand = ["OPEN", "LOOPS"].join("");
  const legacySpacedBrand = ["Open", "Loops"].join(" ");
  const lowerLegacySolid = ["open", "loops"].join("");
  const lowerLegacyHyphenated = ["open", "loops"].join("-");

  test("rejects legacy product-name display variants", () => {
    const displayVariants = [
      `# ${legacyCamelBrand}`,
      `All notable changes to ${legacyCamelBrand} are documented here.`,
      `${legacyTitleBrand} is a scheduler`,
      `${legacyUpperBrand} runtime`,
      `${lowerLegacySolid} is a scheduler`,
      `${legacySpacedBrand} is a scheduler`,
      `${lowerLegacyHyphenated} product`,
      `Powered by ${lowerLegacySolid}.`,
      `Use ${lowerLegacySolid} for scheduling.`,
      `The ${lowerLegacyHyphenated} experience is ready.`,
      `Built with ${lowerLegacySolid}.`,
      `${lowerLegacySolid}-powered automation.`,
      `Modeled on ${lowerLegacyHyphenated}' storage ledger.`,
      `[${lowerLegacyHyphenated}] WARN delayed run`,
      `\\n${legacyCamelBrand} worktree policy:`,
      `Welcome to ${lowerLegacySolid}`,
      `Read the ${lowerLegacySolid} documentation`,
      `# About ${lowerLegacySolid}`,
      `The ${legacyUpperBrand.replace("LOOPS", "-LOOPS")} project`,
    ];

    for (const line of displayVariants) {
      expect(legacyBrandReason(line)).toBeDefined();
    }
  });

  test("allows established compatibility identifiers", () => {
    const compatibilityIdentifiers = [
      `source: "${lowerLegacySolid}"`,
      `const marker = "${lowerLegacySolid}:triage=go";`,
      `const env = "${legacyUpperBrand}_PR_HANDOFF";`,
      `const schema = "${lowerLegacyHyphenated}.migration/v1";`,
      'const role = "open_loops_runtime";',
      `const path = ".${lowerLegacySolid}/pr-handoff";`,
      `const branch = "${lowerLegacySolid}/repo/task";`,
      `name: "${lowerLegacyHyphenated}"`,
    ];

    for (const line of compatibilityIdentifiers) {
      expect(legacyBrandReason(line)).toBeUndefined();
    }
  });

  test("scans tracked text even when it contains a NUL byte", () => {
    const repo = mkdtempSync(join(tmpdir(), "loops-branding-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "snapshot.txt"), Buffer.from(`fixture\u0000${legacyCamelBrand} worktree policy\n`));
      execFileSync("git", ["add", "snapshot.txt"], { cwd: repo });

      expect(scanTrackedFiles(repo)).toEqual(["snapshot.txt:1:legacy-camel-brand"]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("does not skip branding-guard source paths", () => {
    const repo = mkdtempSync(join(tmpdir(), "loops-branding-self-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      mkdirSync(join(repo, "scripts"));
      writeFileSync(
        join(repo, "scripts/check-branding.mjs"),
        `Welcome to ${lowerLegacySolid}\n`,
      );
      execFileSync("git", ["add", "scripts/check-branding.mjs"], { cwd: repo });

      expect(scanTrackedFiles(repo)).toEqual([
        "scripts/check-branding.mjs:1:legacy-leading-context-brand",
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("allows only counted legacy identities with a reason and removal condition", () => {
    const repo = mkdtempSync(join(tmpdir(), "loops-identity-policy-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "compatibility.ts"), `const legacy = "${lowerLegacyHyphenated}.migration/v1";\n`);
      execFileSync("git", ["add", "compatibility.ts"], { cwd: repo });
      const manifest = {
        schema: "loops.legacy-identity-allowlist/v1",
        entries: [{
          path: "compatibility.ts",
          tokens: { [lowerLegacyHyphenated]: 1 },
          reason: "read bundles emitted before the rename",
          removalCondition: "remove after the next major release",
        }],
      };

      expect(scanTrackedIdentityTokens(repo, manifest)).toEqual([]);
      writeFileSync(
        join(repo, "compatibility.ts"),
        `const legacy = "${lowerLegacyHyphenated}.migration/v1";\nconst accidental = "${lowerLegacySolid}:new";\n`,
      );
      expect(scanTrackedIdentityTokens(repo, manifest)).toContain(
        `compatibility.ts:${lowerLegacySolid}:unapproved-legacy-identity:1`,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
