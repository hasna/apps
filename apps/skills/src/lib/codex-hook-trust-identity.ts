import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { need, snapshot, unchanged } from "./codex-hook-trust-files.js";

/** A private release adapter supplies a reviewed registry artifact identity;
 * the normal CLI binds to its own installed entrypoint instead. */
export interface ReviewedSkillsCli { path: string; version: string; sha256: string }

export function bindSkillsCli(command: string, reviewed?: ReviewedSkillsCli) {
  const normal = Bun.which("skills", { PATH: process.env.PATH });
  need(normal, "SKILLS_COMMAND_UNAVAILABLE");
  const resolved = realpathSync(normal);
  const bound = isAbsolute(command) ? command : command === "skills" ? normal : undefined;
  need(bound && realpathSync(bound) === resolved, "SKILLS_COMMAND_MISMATCH");
  const entrypoint = reviewed?.path ?? process.argv[1];
  need(entrypoint && realpathSync(entrypoint) === resolved, "SKILLS_ENTRYPOINT_MISMATCH");
  const cli = snapshot(resolved, false, { readOnlyPackage: true });
  const manifest = snapshot(join(dirname(dirname(resolved)), "package.json"), false, { readOnlyPackage: true });
  const pkg = JSON.parse(manifest.text);
  need(pkg.name === "@hasna/skills" && /^\d+\.\d+\.\d+$/.test(pkg.version) && pkg.bin?.skills === "bin/index.js" && resolved === join(dirname(manifest.file), "bin/index.js"), "SKILLS_PACKAGE_MISMATCH");
  if (reviewed) need(/^[a-f0-9]{64}$/.test(reviewed.sha256) && reviewed.sha256 === cli.sha256 && reviewed.version === pkg.version, "SKILLS_RELEASE_MISMATCH");
  need((cli.stat.mode & 0o100n) !== 0n, "SKILLS_COMMAND_NOT_EXECUTABLE");
  return {
    receipt: { path: resolved, version: pkg.version as string, sha256: cli.sha256, manifestSha256: manifest.sha256 },
    recheck() {
      need(Bun.which("skills", { PATH: process.env.PATH }) === normal && realpathSync(normal) === resolved && realpathSync(bound) === resolved && realpathSync(entrypoint) === resolved, "SKILLS_COMMAND_CHANGED");
      unchanged(cli); unchanged(manifest);
    },
  };
}
