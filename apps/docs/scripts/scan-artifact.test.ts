import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSupportedNpmVersion, packCommand, packedArchive, scanPackedArtifact } from "./scan-artifact";

const originalSpawnSync = Bun.spawnSync;
afterEach(() => { Bun.spawnSync = originalSpawnSync; });

function output(stdout: string, exitCode = 0) {
  return { stdout: Buffer.from(stdout), stderr: Buffer.from(""), exitCode } as ReturnType<typeof Bun.spawnSync>;
}

function fixture(check: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "docs-artifact-test-"));
  try { check(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

describe("npm release artifact gate", () => {
  test("requires npm 11+ and keeps the published scanner version pinned", () => {
    for (const version of ["11.0.0", "11.19.0", "12.0.0"]) {
      expect(() => assertSupportedNpmVersion(version)).not.toThrow();
    }
    for (const version of ["10.9.3", "9.9.4", "", "unknown", "11", "11.19.0\nextra",
      "v11.19.0", "11.19.0-beta.1", "011.19.0", "11.019.0", "9007199254740992.0.0"]) {
      expect(() => assertSupportedNpmVersion(version)).toThrow();
    }
    const root = join(import.meta.dir, "..");
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies["@hasna/contracts"]).toBe("0.11.1");
    expect(JSON.parse(readFileSync(join(root, "hasna.contract.json"), "utf8")).kitVersion).toBe("0.11.1");
  });

  test("unavailable or untrusted npm version output is redacted and never reaches pack", () => {
    for (const probe of [
      () => output("untrusted-probe-output"),
      () => output("untrusted-probe-output", 1),
      () => { throw new Error("untrusted-probe-output"); },
    ]) {
      let calls = 0;
      spyOn(Bun, "spawnSync").mockImplementation((() => {
        calls++;
        return probe();
      }) as typeof Bun.spawnSync);
      let message = "";
      try { scanPackedArtifact(); } catch (error) { message = String(error); }
      expect(message).toContain("npm >=11");
      expect(message).not.toContain("untrusted-probe-output");
      expect(calls).toBe(1);
    }
  });

  test("real npm materializes the archive under inherited dry-run without prepack or prepare recursion", () => fixture((root) => {
    const destination = join(root, "packed");
    mkdirSync(destination);
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "docs-pack-fixture", version: "1.0.0", files: ["index.js"],
      scripts: { prepack: "node -e 'process.exit(91)'", prepare: "node -e 'process.exit(92)'" },
    }));
    writeFileSync(join(root, "index.js"), "export const fixture = true;\n");
    const env = {
      PATH: process.env.PATH ?? "", HOME: join(root, "home"),
      npm_config_cache: join(root, "npm-cache"), npm_config_userconfig: join(root, "user.npmrc"),
      npm_config_globalconfig: join(root, "global.npmrc"), npm_config_dry_run: "true",
    };
    const options = { cwd: root, env, stdout: "pipe", stderr: "pipe" } as const;
    const version = originalSpawnSync(["npm", "--version"], options);
    expect(version.exitCode).toBe(0);
    assertSupportedNpmVersion(version.stdout.toString().trim());
    const command = packCommand(destination);
    expect(command.slice(0, 3)).toEqual(["npm", "pack", "."]);
    expect(command).toContain("--json");
    expect(command).toContain("--ignore-scripts");
    expect(command).toContain("--workspaces=false");
    expect(command).toContain("--dry-run=false");

    // Negative control: the inherited dry-run reports a filename but creates no file.
    const dry = originalSpawnSync(command.filter((arg) => arg !== "--dry-run=false"), options);
    expect(dry.exitCode).toBe(0);
    expect(() => packedArchive(dry.stdout.toString(), destination)).toThrow("local regular archive");

    const packed = originalSpawnSync(command, options);
    expect(packed.exitCode).toBe(0);
    const archive = packedArchive(packed.stdout.toString(), destination);
    expect(lstatSync(archive).isFile()).toBe(true);
    const contents = originalSpawnSync(["tar", "-tzf", archive], { stdout: "pipe", stderr: "pipe" });
    expect(contents.exitCode).toBe(0);
    expect(contents.stdout.toString()).toContain("package/index.js");

    // Both hooks are real failure controls, not a fixture npm would never execute.
    const unsuppressed = originalSpawnSync(command.filter((arg) => arg !== "--ignore-scripts"), options);
    expect(unsuppressed.exitCode).toBe(91);
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "docs-pack-fixture", version: "1.0.0", scripts: { prepare: "node -e 'process.exit(92)'" },
    }));
    const prepare = originalSpawnSync(command.filter((arg) => arg !== "--ignore-scripts"), options);
    expect(prepare.exitCode).toBe(92);
  }), 20_000);

  test("malformed, ambiguous, and unsafe pack results fail closed", () => fixture((root) => {
    const cases: unknown[] = [null, {}, [], [null], [{ filename: "a.tgz" }, { filename: "b.tgz" }],
      [{}], [{ filename: 42 }], [{ filename: "" }], [{ filename: "../outside.tgz" }],
      [{ filename: "/outside.tgz" }], [{ filename: "sub/a.tgz" }], [{ filename: "sub\\a.tgz" }],
      [{ filename: "a.txt" }], [{ filename: "--option.tgz" }], [{ filename: "missing.tgz" }]];
    for (const packed of ["not json", ...cases.map((value) => JSON.stringify(value))]) {
      expect(() => packedArchive(packed, root)).toThrow();
    }
  }));

  test("symlinks and non-regular archives are not scanner targets", () => fixture((root) => {
    const destination = join(root, "packed");
    mkdirSync(destination);
    writeFileSync(join(root, "outside.tgz"), "fixture");
    symlinkSync(join(root, "outside.tgz"), join(destination, "linked.tgz"));
    mkdirSync(join(destination, "directory.tgz"));
    for (const filename of ["linked.tgz", "directory.tgz"]) {
      expect(() => packedArchive(JSON.stringify([{ filename }]), destination)).toThrow("local regular archive");
    }
  }));

  test("scans exactly the selected local archive and cleans the temporary workspace", () => fixture((root) => {
    const files = join(root, "package");
    mkdirSync(files);
    writeFileSync(join(files, "index.js"), "export const fixture = true;\n");
    const source = join(root, "source.tgz");
    const tar = originalSpawnSync(["tar", "-czf", source, "-C", root, "package"]);
    expect(tar.exitCode).toBe(0);
    let workspace = "";
    const calls: string[][] = [];
    spyOn(Bun, "spawnSync").mockImplementation(((...args: unknown[]) => {
      const command = args[0] as string[];
      if (command[0] !== "npm") return Reflect.apply(originalSpawnSync, Bun, args);
      calls.push(command);
      if (calls.length === 1) {
        expect(command).toEqual(["npm", "--version"]);
        return output("11.19.0");
      }
      workspace = command[command.indexOf("--pack-destination") + 1]!;
      expect(command).toEqual(packCommand(workspace));
      copyFileSync(source, join(workspace, "fixture.tgz"));
      return output(JSON.stringify([{ filename: "fixture.tgz" }]));
    }) as typeof Bun.spawnSync);
    const { report } = scanPackedArtifact();
    expect(report.ok).toBe(true);
    expect(report.scanMode).toBe("packed_artifact");
    expect(report.membersScanned).toBeGreaterThan(0);
    expect(report.target).toBe(join(workspace, "fixture.tgz"));
    expect(calls).toHaveLength(2);
    expect(existsSync(workspace)).toBe(false);
  }));

  test("old npm, pack failures, and invalid tarballs cannot become successful scans", () => {
    let calls = 0;
    spyOn(Bun, "spawnSync").mockImplementation((() => {
      calls++;
      return output("10.9.3");
    }) as typeof Bun.spawnSync);
    expect(() => scanPackedArtifact()).toThrow("npm >=11");
    expect(calls).toBe(1);
    for (const failPack of [true, false]) {
      let workspace = "";
      let calls = 0;
      spyOn(Bun, "spawnSync").mockImplementation(((...args: unknown[]) => {
        const command = args[0] as string[];
        if (command[0] !== "npm") return Reflect.apply(originalSpawnSync, Bun, args);
        calls++;
        if (calls === 1) return output("11.19.0");
        workspace = command[command.indexOf("--pack-destination") + 1]!;
        writeFileSync(join(workspace, "fixture.tgz"), "not a tarball");
        return output(JSON.stringify([{ filename: "fixture.tgz" }]), failPack ? 9 : 0);
      }) as typeof Bun.spawnSync);
      if (failPack) expect(() => scanPackedArtifact()).toThrow("exited 9");
      else expect(() => scanPackedArtifact()).toThrow();
      expect(existsSync(workspace)).toBe(false);
    }
  });
});
