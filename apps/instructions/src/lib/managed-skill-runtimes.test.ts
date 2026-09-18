import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectManagedSkillRuntimes, reconcileManagedSkillRuntimes } from "./managed-skill-runtimes";
import { makeTempRoot } from "./test-temp-root";

const roots: string[] = [];
function fixture() {
  const root = makeTempRoot("instructions-legacy-skills-");
  roots.push(root);
  const journal = join(root, "runtime-journal");
  const command = join(root, "conversations");
  writeFileSync(command, `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(journal)}, "called\\n");
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("0.5.28");
else console.log("--from <agent> --all --full-content");
`, { mode: 0o755 });
  return { root, journal, command };
}
function marker(root: string, agent = ".claude") {
  const dir = join(root, agent, "skills", "inbox");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, "synthetic legacy bytes\n", { mode: 0o640 });
  return path;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("retired managed skill reconciliation", () => {
  test.each([false, true])("explicit old assetPath cannot reinstall native payloads (dryRun: %s)", async (dryRun) => {
    const { root, journal, command } = fixture();
    const paths = [marker(root), marker(root, ".codex")];
    const before = paths.map((path) => ({ content: readFileSync(path, "utf8"), inode: lstatSync(path).ino, mode: lstatSync(path).mode }));
    const assetPath = join(root, "synthetic-contract.md");
    writeFileSync(assetPath, "There is no separate executable. conversations watch --from <agent> --all\n");
    const report = await reconcileManagedSkillRuntimes({ homeDir: root, assetPath, conversationsCommand: command,
      agent: "synthetic-agent", deliveryVerified: true, dryRun });
    expect(report).toMatchObject({ changed: 0, failed: 1, dry_run: dryRun });
    expect(report.runtimes[0]).toMatchObject({ action: "failed", skill_contracts_changed: 0, expected_skill_sha256: null,
      hosted_heartbeat: "unverified", delivery_verified: false, manual_fallback_ready: false, healthy: false });
    expect(report.runtimes[0]!.reason).toContain("Skills CLI");
    expect(paths.map((path) => ({ content: readFileSync(path, "utf8"), inode: lstatSync(path).ino, mode: lstatSync(path).mode }))).toEqual(before);
    expect(existsSync(journal)).toBe(false);
  });

  test("inspection is metadata-only and cannot send a heartbeat", () => {
    const { root, journal, command } = fixture();
    const path = marker(root);
    const report = inspectManagedSkillRuntimes({ homeDir: root, conversationsCommand: command, agent: "synthetic-agent", deliveryVerified: true });
    expect(report).toMatchObject({ skills_present: 1, healthy: 0, missing: 1 });
    expect(report.runtimes[0]!.skill_markers).toEqual([path]);
    expect(report.runtimes[0]!.hosted_heartbeat).toBe("unverified");
    expect(JSON.stringify(report)).not.toContain("synthetic legacy bytes");
    expect(existsSync(journal)).toBe(false);
  });

  test("a migrated home requires neither native skills nor a runtime executable", async () => {
    const { root, journal, command } = fixture();
    const report = await reconcileManagedSkillRuntimes({ homeDir: root, conversationsCommand: command, agent: "synthetic-agent" });
    expect(report).toMatchObject({ changed: 0, failed: 0 });
    expect(report.runtimes[0]).toMatchObject({ skill_present: false, action: "skipped", hosted_heartbeat: "unverified", delivery_verified: false });
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(existsSync(journal)).toBe(false);
  });

  test.each(["target", "ancestor"])("symlinked %s is preserved and reported without following it", async (kind) => {
    const { root, journal, command } = fixture();
    const outside = makeTempRoot("instructions-symlink-target-");
    roots.push(outside);
    const original = marker(outside);
    const home = join(root, "home");
    mkdirSync(home);
    const path = join(home, ".claude", "skills", "inbox", "SKILL.md");
    if (kind === "ancestor") symlinkSync(join(outside, ".claude"), join(home, ".claude"));
    else { mkdirSync(join(home, ".claude", "skills", "inbox"), { recursive: true }); symlinkSync(original, path); }
    const report = await reconcileManagedSkillRuntimes({ homeDir: home, conversationsCommand: command, agent: "synthetic-agent" });
    expect(report).toMatchObject({ changed: 0, failed: 1 });
    expect(report.runtimes[0]!.skill_markers).toContain(path);
    expect(readFileSync(original, "utf8")).toBe("synthetic legacy bytes\n");
    expect(lstatSync(kind === "ancestor" ? join(home, ".claude") : path).isSymbolicLink()).toBe(true);
    expect(existsSync(journal)).toBe(false);
  });
});
