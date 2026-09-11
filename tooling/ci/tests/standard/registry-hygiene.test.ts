/**
 * registry-hygiene — standard-adherence suite.
 *
 * The census exception registries (census.ts) are two-sided: a recorded
 * exception whose member now conforms is stale and fails the suite. That
 * contract has a blind spot — a member that was DELETED from apps/ is
 * neither "missing" nor "stale", so its entries rot silently. Measured
 * 2026-09-11: 12 deleted members (docs, draw, models, slides, tables,
 * terminal, test-guard, announce, billing, controls, tickets, context) plus
 * `paths` were still carried across five registries (T1 §3.2 finding 8).
 *
 * This test closes the blind spot: every recorded exception, in every
 * registry, must name a member that exists in apps/ today.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  APPS_DIR,
  membersIn,
  CLI_EXCEPTIONS,
  MCP_EXCEPTIONS,
  SERVE_EXCEPTIONS,
  SDK_EXCEPTIONS,
  LICENSE_EXCEPTIONS,
  MANIFEST_MISSING_EXCEPTIONS,
  CONTRACTS_EXCEPTIONS,
  KIT_VERSION_EXCEPTIONS,
  NO_VALIDATOR_PIN,
  PUBLISH_CONFIG_EXCEPTIONS,
  NON_PUBLISHABLE,
  PRIVATE_TRUE_EXCEPTIONS,
} from "./census";

export function registryEntries(): Array<{ registry: string; member: string }> {
  const out: Array<{ registry: string; member: string }> = [];
  const push = (registry: string, members: string[]) => members.forEach((member) => out.push({ registry, member }));
  push("CLI_EXCEPTIONS", CLI_EXCEPTIONS.map((e) => e.member));
  push("MCP_EXCEPTIONS", MCP_EXCEPTIONS.map((e) => e.member));
  push("SERVE_EXCEPTIONS", SERVE_EXCEPTIONS.map((e) => e.member));
  push("SDK_EXCEPTIONS", SDK_EXCEPTIONS.map((e) => e.member));
  push("LICENSE_EXCEPTIONS", LICENSE_EXCEPTIONS.map((e) => e.member));
  push("MANIFEST_MISSING_EXCEPTIONS", MANIFEST_MISSING_EXCEPTIONS.map((e) => e.member));
  push("CONTRACTS_EXCEPTIONS", CONTRACTS_EXCEPTIONS.map((e) => e.member));
  push("KIT_VERSION_EXCEPTIONS", KIT_VERSION_EXCEPTIONS.map((e) => e.member));
  push("NO_VALIDATOR_PIN", NO_VALIDATOR_PIN);
  push("PUBLISH_CONFIG_EXCEPTIONS", PUBLISH_CONFIG_EXCEPTIONS);
  push("NON_PUBLISHABLE", NON_PUBLISHABLE);
  push("PRIVATE_TRUE_EXCEPTIONS", PRIVATE_TRUE_EXCEPTIONS);
  return out;
}

export function ghostEntries(appsDir: string, entries: Array<{ registry: string; member: string }>): string[] {
  const present = new Set(membersIn(appsDir).map((m) => m.name));
  return entries.filter((e) => !present.has(e.member)).map((e) => `${e.registry}: ${e.member}`).sort();
}

describe("standard-adherence: registry hygiene (no exception names a deleted member)", () => {
  test("every recorded exception names a member that exists in apps/", () => {
    const ghosts = ghostEntries(APPS_DIR, registryEntries());
    expect(ghosts, "exception entries for members that no longer exist — delete them").toEqual([]);
  });

  test("no member is recorded twice in the same registry", () => {
    const seen = new Map<string, number>();
    for (const e of registryEntries()) seen.set(`${e.registry}: ${e.member}`, (seen.get(`${e.registry}: ${e.member}`) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  test("self-test: a ghost entry fires, a present entry stays silent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "registry-hygiene-self-test-"));
    try {
      fs.mkdirSync(path.join(root, "apps", "present"), { recursive: true });
      fs.writeFileSync(path.join(root, "apps", "present", "package.json"), JSON.stringify({ name: "@hasna/present" }));
      const entries = [
        { registry: "X", member: "present" },
        { registry: "X", member: "ghost" },
      ];
      expect(ghostEntries(path.join(root, "apps"), entries)).toEqual(["X: ghost"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
