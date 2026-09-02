import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packCommand, scanPackedArtifact, scannerCommand } from "./scan-artifact";

afterEach(() => { Bun.spawnSync = originalSpawnSync; });
const originalSpawnSync = Bun.spawnSync;

function output(stdout: string, exitCode = 0) {
  return { stdout: Buffer.from(stdout), stderr: Buffer.from(""), exitCode } as ReturnType<typeof Bun.spawnSync>;
}

describe("npm artifact gate", () => {
  test("scans exactly the local npm tarball, suppresses lifecycle recursion, and cleans its workspace", () => {
    let workspace = "";
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation(((command: string[]) => {
      calls.push(command);
      if (calls.length === 1) {
        expect(command.slice(0, 2)).toEqual(["npm", "pack"]);
        expect(command).toContain("--json");
        expect(command).toContain("--ignore-scripts");
        expect(command).toContain("--workspaces=false");
        expect(command).toContain("--dry-run=false");
        expect(command[2]).toBe(".");
        workspace = command[command.indexOf("--pack-destination") + 1]!;
        writeFileSync(join(workspace, "hasna-paths-0.2.2.tgz"), "fixture");
        return output(JSON.stringify([{ filename: "hasna-paths-0.2.2.tgz" }]));
      }
      expect(command).toEqual(scannerCommand(join(workspace, "hasna-paths-0.2.2.tgz")));
      return output("artifact scan: clean");
    }) as typeof Bun.spawnSync);
    expect(scanPackedArtifact().output).toBe("artifact scan: clean");
    expect(calls).toHaveLength(2);
    expect(existsSync(workspace)).toBe(false);
  });

  test("real npm creates a tarball under inherited dry-run and does not run lifecycle hooks", () => {
    const fixture = mkdtempSync(join(tmpdir(), "paths-npm-pack-test-"));
    const destination = join(fixture, "packed");
    mkdirSync(destination);
    writeFileSync(join(fixture, "package.json"), JSON.stringify({
      name: "paths-pack-fixture", version: "1.0.0", files: ["index.js"],
      scripts: { prepack: "node -e 'process.exit(91)'", prepare: "node -e 'process.exit(92)'" },
    }));
    writeFileSync(join(fixture, "index.js"), "export const fixture = true;\n");
    const spawnOptions = { cwd: fixture, env: { ...process.env, npm_config_dry_run: "true" }, stdout: "pipe", stderr: "pipe" } as const;
    try {
      const negative = originalSpawnSync(packCommand(destination).filter((arg) => arg !== "--dry-run=false"), spawnOptions);
      expect(negative.exitCode).toBe(0);
      const reported = JSON.parse(new TextDecoder().decode(negative.stdout));
      expect(reported).toHaveLength(1);
      expect(existsSync(join(destination, reported[0].filename))).toBe(false);

      const positive = originalSpawnSync(packCommand(destination), spawnOptions);
      expect(positive.exitCode).toBe(0);
      const packed = JSON.parse(new TextDecoder().decode(positive.stdout));
      expect(packed).toHaveLength(1);
      const archive = join(destination, packed[0].filename);
      expect(existsSync(archive)).toBe(true);
      const contents = originalSpawnSync(["tar", "-tzf", archive], { stdout: "pipe", stderr: "pipe" });
      expect(contents.exitCode).toBe(0);
      expect(new TextDecoder().decode(contents.stdout)).toContain("package/index.js");
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  test("malformed, ambiguous, and unsafe npm results never reach the scanner", () => {
    const cases: unknown[] = [null, {}, [], [{ filename: "a.tgz" }, { filename: "b.tgz" }], [{}], [{ filename: 42 }], [{ filename: "" }], [{ filename: "../outside.tgz" }], [{ filename: "/outside.tgz" }], [{ filename: "sub/a.tgz" }], [{ filename: "sub\\a.tgz" }], [{ filename: "a.txt" }], [{ filename: "--option.tgz" }], [{ filename: "missing.tgz" }]];
    for (const packed of ["not json", ...cases.map((value) => JSON.stringify(value))]) {
      const calls: string[][] = [];
      spyOn(Bun, "spawnSync").mockImplementation(((command: string[]) => {
        calls.push(command);
        return output(packed);
      }) as typeof Bun.spawnSync);
      expect(() => scanPackedArtifact()).toThrow();
      expect(calls).toHaveLength(1);
    }
  });

  test("symlinks and non-regular archives fail closed", () => {
    const external = mkdtempSync(join(tmpdir(), "paths-test-target-"));
    try {
      writeFileSync(join(external, "target.tgz"), "fixture");
      for (const symlink of [true, false]) {
        const calls: string[][] = [];
        spyOn(Bun, "spawnSync").mockImplementation(((command: string[]) => {
          calls.push(command);
          const workspace = command[command.indexOf("--pack-destination") + 1]!;
          if (symlink) symlinkSync(join(external, "target.tgz"), join(workspace, "archive.tgz"));
          else mkdirSync(join(workspace, "archive.tgz"));
          return output(JSON.stringify([{ filename: "archive.tgz" }]));
        }) as typeof Bun.spawnSync);
        expect(() => scanPackedArtifact()).toThrow();
        expect(calls).toHaveLength(1);
      }
    } finally { rmSync(external, { recursive: true, force: true }); }
  });

  test("pack and scanner failures propagate and remove temporary files", () => {
    for (const failPack of [true, false]) {
      let workspace = "";
      let calls = 0;
      spyOn(Bun, "spawnSync").mockImplementation(((command: string[]) => {
        calls++;
        if (calls === 1) {
          workspace = command[command.indexOf("--pack-destination") + 1]!;
          writeFileSync(join(workspace, "archive.tgz"), "fixture");
          return output(JSON.stringify([{ filename: "archive.tgz" }]), failPack ? 9 : 0);
        }
        return output("", 7);
      }) as typeof Bun.spawnSync);
      expect(() => scanPackedArtifact()).toThrow(failPack ? "exited 9" : "exited 7");
      expect(calls).toBe(failPack ? 1 : 2);
      expect(existsSync(workspace)).toBe(false);
    }
  });
});
