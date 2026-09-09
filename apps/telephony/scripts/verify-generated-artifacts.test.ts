/**
 * Pins the release-stamp byte-repro gate: the `verify:generated` script must
 * stay a single command, its stamp pattern must stay live, and the committed
 * SDK client header must carry the package version — a bump that forgets
 * `bun run generate:sdk` fails `bun test` here before it can publish.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERATED_FILE,
  STAMP_COUNTER_FIXTURE,
  STAMP_FIXTURE,
  STAMP_PATTERN,
  committedStamp,
  packageVersion,
  patternSelfCheck,
  stampedVersion,
} from "./verify-generated-artifacts.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("verify:generated", () => {
  it("stays a single command — the package script names this script and nothing else", () => {
    const scripts = JSON.parse(readFileSync(join(appRoot, "package.json"), "utf8")).scripts;
    expect(scripts["verify:generated"]).toBe("bun scripts/verify-generated-artifacts.mjs");
  });

  it("keeps a live stamp pattern: matches the stale 0.2.11 header it was added to kill", () => {
    expect(patternSelfCheck()).toEqual([]);
    expect(STAMP_PATTERN.test(STAMP_FIXTURE)).toBe(true);
    expect(stampedVersion(STAMP_FIXTURE)).toBe("0.2.11");
    expect(STAMP_PATTERN.test(STAMP_COUNTER_FIXTURE)).toBe(false);
  });

  it("requires the committed generated header to carry the package version", () => {
    const expected = packageVersion();
    expect(committedStamp(), `${GENERATED_FILE} stamp != package.json (${expected}) — run \`bun run generate:sdk\` and commit the result`).toBe(expected);
  });
});