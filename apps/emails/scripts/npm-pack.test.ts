import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSupportedNpmVersion, assertSafeArchive, npmPackArgs, packNpmArtifact, resolveNpmArchive } from "./npm-pack.mjs";

const execute = childProcess.execFileSync;
const fixtureRoots: string[] = [];
afterEach(() => {
  mock.restore();
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "emails-npm-pack-test-"));
  fixtureRoots.push(root);
  const destination = join(root, "packed");
  mkdirSync(destination);
  const manifest = { name: "emails-pack-fixture", version: "1.0.0", files: ["index.js"],
    scripts: { prepack: "node -e 'process.exit(91)'", prepare: "node -e 'process.exit(92)'" } };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "index.js"), "export const fixture = true;\n");
  return { root, destination, manifest };
}

describe("Emails actual npm artifact", () => {
  test("requires a parsed npm 11 or newer release version", () => {
    for (const version of ["11.0.0", "11.19.0", "12.0.0"]) expect(() => assertSupportedNpmVersion(version)).not.toThrow();
    for (const version of ["10.9.8", "", "11", "v11.0.0", "011.0.0", "11.0.0-beta.1", "11.0.0\nprivate-diagnostic", "9007199254740992.0.0"]) {
      expect(() => assertSupportedNpmVersion(version)).toThrow("npm >=11.0.0");
    }
  });

  test("old, malformed and failed npm probes stop before packing without exposing output", () => {
    for (const version of ["10.9.8", "private-diagnostic", null]) {
      const calls: unknown[] = [];
      spyOn(childProcess, "execFileSync").mockImplementation(((command: string, args: string[]) => {
        calls.push([command, args]);
        if (version === null) throw new Error("private-diagnostic");
        return version;
      }) as typeof execute);
      let failure = "";
      try { packNpmArtifact("/unused", "/unused"); } catch (error) { failure = (error as Error).message; }
      expect(failure).toContain("npm >=11.0.0");
      expect(failure).not.toContain("private-diagnostic");
      expect(calls).toEqual([["npm", ["--version"]]]);
    }
  });

  test("rejects malformed, ambiguous, unsafe and wrong-identity npm JSON", () => {
    const { destination, manifest } = fixture();
    const good = { filename: "fixture.tgz", name: manifest.name, version: manifest.version };
    writeFileSync(join(destination, good.filename), "fixture");
    expect(resolveNpmArchive(JSON.stringify([good]), destination, manifest)).toBe(join(destination, good.filename));
    const cases = [null, {}, [], [good, good], [{}], [{ ...good, filename: "../outside.tgz" }],
      [{ ...good, filename: "/outside.tgz" }], [{ ...good, filename: "sub/a.tgz" }],
      [{ ...good, filename: "sub\\a.tgz" }], [{ ...good, filename: "--option.tgz" }],
      [{ ...good, filename: "a.txt" }], [{ ...good, name: "another-package" }],
      [{ ...good, version: "2.0.0" }], [{ ...good, filename: "missing.tgz" }]];
    for (const output of ["not json", ...cases.map((value) => JSON.stringify(value))]) {
      expect(() => resolveNpmArchive(output, destination, manifest)).toThrow();
    }
  });

  test("rejects symlinks, directories and empty archive files", () => {
    const { root, destination, manifest } = fixture();
    symlinkSync(join(root, "index.js"), join(destination, "link.tgz"));
    mkdirSync(join(destination, "dir.tgz"));
    writeFileSync(join(destination, "empty.tgz"), "");
    for (const filename of ["link.tgz", "dir.tgz", "empty.tgz"]) {
      expect(() => resolveNpmArchive(JSON.stringify([{ ...manifest, filename }]), destination, manifest)).toThrow();
    }
  });

  test("real npm overrides inherited dry-run and suppresses prepack and prepare", () => {
    const { root, destination } = fixture();
    const env = { ...process.env, npm_config_dry_run: "true" };
    const options = { cwd: root, env, encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] as const };
    const negative = JSON.parse(execute("npm", npmPackArgs(destination).filter((arg) => arg !== "--dry-run=false"), options));
    expect(negative).toHaveLength(1);
    expect(existsSync(join(destination, negative[0].filename))).toBe(false);
    // Exercise the production helper, keeping the inherited dry-run variable in its subprocesses.
    spyOn(childProcess, "execFileSync").mockImplementation(((command: string, args: string[], config: object) =>
      execute(command, args, { ...config, env })) as typeof execute);
    const archive = packNpmArtifact(root, destination);
    expect(existsSync(archive)).toBe(true);
    const packed = JSON.parse(execute("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
    expect(packed.name).toBe("emails-pack-fixture");
    expect(packed.version).toBe("1.0.0");
    expect(execute("tar", ["-xOf", archive, "package/index.js"], { encoding: "utf8" })).toBe(readFileSync(join(root, "index.js"), "utf8"));
  }, 30_000);

  test("both lifecycle traps fail when scripts are deliberately enabled", () => {
    const { root, destination, manifest } = fixture();
    for (const script of ["prepack", "prepare"] as const) {
      writeFileSync(join(root, "package.json"), JSON.stringify({ ...manifest, scripts: { [script]: manifest.scripts[script] } }));
      const result = childProcess.spawnSync("npm", [...npmPackArgs(destination).filter((arg) => arg !== "--ignore-scripts"), "--ignore-scripts=false"],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      expect(result.status).toBe(script === "prepack" ? 91 : 92);
    }
  }, 30_000);

  test("archive validation rejects links before any extraction", () => {
    const { root, destination } = fixture();
    mkdirSync(join(root, "package"));
    symlinkSync("../index.js", join(root, "package", "escape.js"));
    const archive = join(destination, "unsafe.tgz");
    execute("tar", ["-czf", archive, "-C", root, "package"], { stdio: "pipe" });
    expect(() => assertSafeArchive(archive)).toThrow();
  });

  test("archive validation rejects paths outside package, traversal and duplicates", () => {
    for (const names of ["outside/index.js\n", "package/../outside.js\n", "package/a.js\npackage/a.js\n", "package/\\escape.js\n", ""]) {
      spyOn(childProcess, "execFileSync").mockImplementation(((command: string, args: string[]) =>
        args[0] === "-tzf" ? names : "-rw-r--r-- fixture\n") as typeof execute);
      expect(() => assertSafeArchive("unused.tgz")).toThrow();
    }
  });
});
