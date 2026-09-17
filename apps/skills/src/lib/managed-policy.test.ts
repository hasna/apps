import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertNativeExportAllowed } from "./agent-integration.js";
import { readManagedSkillPolicy, requiresCliSkillLoading } from "./managed-policy.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "skills-policy-")); roots.push(root); return root; }

test("only an absent policy permits unmanaged compatibility; malformed policies cannot enable native export", () => {
  const root = fixture(), path = join(root, "agent-policy.json");
  expect(readManagedSkillPolicy(root)).toBeNull();
  expect(requiresCliSkillLoading(root)).toBe(false);
  expect(() => assertNativeExportAllowed(root)).not.toThrow();
  for (const invalid of [{}, { loading: "CLI" }, { loading: "native" }, { loading: "" },
    { version: 2, loading: "cli" }, { loading: "cli", profileId: "team..draft" }]) {
    const bytes = `${JSON.stringify(invalid)}\n`;
    writeFileSync(path, bytes);
    expect(() => readManagedSkillPolicy(root)).toThrow("refusing legacy fallback");
    expect(() => requiresCliSkillLoading(root)).toThrow("refusing legacy fallback");
    expect(() => assertNativeExportAllowed(root)).toThrow("refusing legacy fallback");
    expect(readFileSync(path, "utf8")).toBe(bytes);
  }
});

test("valid managed policies retain optional legacy version/profile fields and reject native exports", () => {
  const root = fixture(), path = join(root, "agent-policy.json");
  for (const policy of [{ loading: "cli" }, { version: 1, loading: "cli", profileId: "engineering", extension: { preserved: true } }]) {
    writeFileSync(path, JSON.stringify(policy));
    expect(requiresCliSkillLoading(root)).toBe(true);
    expect(() => assertNativeExportAllowed(root)).toThrow("NATIVE_SKILL_EXPORT_DISABLED");
  }
});

test("dangling policy links cannot be mistaken for an unmanaged station by the export guard", () => {
  const root = fixture();
  symlinkSync(join(root, "missing-policy"), join(root, "agent-policy.json"));
  expect(() => assertNativeExportAllowed(root)).toThrow("refusing legacy fallback");
});
