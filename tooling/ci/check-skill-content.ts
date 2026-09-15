/** Public software must never track operational skill payloads. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

export function forbiddenSkillContent(path: string): boolean {
  return /(^|\/)SKILL\.md$/i.test(path)
    || /^apps\/[^/]+\/(?:skills|agent-skills)\//i.test(path)
    || /(?:^|\/)(?:\.(?:claude|codex|cursor|codewith)|opencode)\/skills\//i.test(path);
}

function check(root: string): string[] {
  const files = execFileSync("git", ["ls-files", "--cached", "--full-name", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  if (files.length === 0) throw new Error("Content gate requires a populated Git index");
  return files.filter(forbiddenSkillContent);
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "skill-content-gate-"));
  try {
    execFileSync("git", ["init", "-q", root]);
    const good = ["apps/skills/src/index.ts", "docs/skill-standard.md", "apps/example/src/skills/client.ts"];
    const bad = ["apps/example/skills/private/src/index.ts", "apps/example/.claude/skills/secret/helper.ts", "docs/hidden/SKILL.md", "apps/example/agent-skills/internal/package.json", "misc/skill.MD"];
    const stage = (paths: string[]) => {
      for (const name of paths) { const path = join(root, name); mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, "synthetic fixture\n"); }
      execFileSync("git", ["add", "--", ...paths], { cwd: root });
    };
    stage(good);
    if (check(root).length !== 0) throw new Error("Content gate rejected public software");
    stage(bad);
    if (JSON.stringify(check(root).sort()) !== JSON.stringify(bad.sort())) throw new Error("Content gate missed a private payload");
    console.log("Skill content gate self-test passed (software accepted, payloads rejected)");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--self-test") selfTest();
    else {
      if (args.length !== 0 && !(args.length === 2 && args[0] === "--root")) throw new Error("Usage: check-skill-content [--root <repo> | --self-test]");
      const findings = check(resolve(args[1] ?? process.cwd()));
      if (findings.length) {
        console.error(`Skill content gate refused ${findings.length} tracked payload paths. Keep operational skills in private storage; inspect the Git index locally.`);
        process.exitCode = 1;
      } else console.log("Skill content gate passed: no tracked skill payloads");
    }
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }
}
