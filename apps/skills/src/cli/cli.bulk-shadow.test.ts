import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliInCwd } from "./cli.test-utils";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
for (const command of ["port", "add"]) test(command + " --all forwards explicit shadow permission without granting overwrite", async () => {
  const work = mkdtempSync(join(tmpdir(), "cli-bulk-shadow-")), home = join(work, "home"), source = join(work, "source"), skill = join(source, "instruction");
  mkdirSync(home); mkdirSync(skill, { recursive: true });
  const document = "---\nname: blog-article\ndescription: Owned bulk CLI fixture\nkind: instruction\n---\n\nReviewed local instruction.\n";
  writeFileSync(join(skill, "SKILL.md"), document);
  const destination = join(home, ".hasna/skills/installed/blog-article");
  try {
    const env = { HOME: home };
    const refusal = await runCliInCwd([command, source, "--all", "--json"], work, env);
    expect(refusal.exitCode).toBe(1);
    expect(JSON.parse(refusal.stdout)).toMatchObject({ succeeded: 0, failed: 1 });
    expect(existsSync(destination)).toBe(false);
    const accepted = await runCliInCwd([command, source, "--all", "--allow-shadow", "--json"], work, env);
    expect(accepted.exitCode).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({ total: 1, succeeded: 1, failed: 0, skipped: [] });
    expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe(document);
    writeFileSync(join(destination, "retained"), "No implicit overwrite");
    const collision = await runCliInCwd([command, source, "--all", "--allow-shadow", "--json"], work, env);
    expect(collision.exitCode).toBe(1);
    expect(JSON.parse(collision.stdout).skipped[0].reason).toContain("already exists");
    expect(readFileSync(join(destination, "retained"), "utf8")).toBe("No implicit overwrite");
    const replaced = await runCliInCwd([command, source, "--all", "--allow-shadow", "--overwrite"], work, env);
    expect(replaced.exitCode).toBe(0); expect(replaced.stdout).toContain("Imported 1/1 skill(s)");
    expect(existsSync(join(destination, "retained"))).toBe(false);
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(document);
    expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe(document);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
