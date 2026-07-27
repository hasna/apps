import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const guardPath = join(import.meta.dir, "check-package-secrets.ts");
const repoRoot = join(import.meta.dir, "..");
const repoPackageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
  files: string[];
  scripts: Record<string, string>;
};

// Split so a staged-diff credential scan does not trip over this file. Neither
// value is real; both only need to match the guard's token shapes.
const fakeNpmToken = "npm_" + "z".repeat(40);
const fakeGithubToken = "ghp" + "_" + "z".repeat(40);

type Fixture = { dir: string; write: (path: string, contents: string | Uint8Array) => void };

// A throwaway package whose working tree contains files git does not track, so
// `git ls-files` cannot see them and only the packed-file list can.
function makeFixture(files: string[]): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "connectors-package-secrets-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "fixture-pack", version: "0.0.0", files }, null, 2)}\n`);
  execFileSync("git", ["init", "--quiet"], { cwd: dir, stdio: "ignore" });
  return {
    dir,
    write(path, contents) {
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    },
  };
}

function runGuard(dir: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["run", guardPath], { cwd: dir, encoding: "utf-8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function packedPaths(dir: string): string[] {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: dir,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(output) as Array<{ files?: Array<{ path: string }> }>;
  return (parsed[0]?.files ?? []).map((file) => file.path);
}

describe("check-package-secrets", () => {
  test("flags a credential in an untracked per-connector lockfile that only the packed list can see", () => {
    const fixture = makeFixture(["connectors/"]);
    try {
      fixture.write("connectors/acme/index.ts", "export const acme = 1;\n");
      fixture.write("connectors/acme/yarn.lock", `# yarn lockfile v1\n_authToken=${fakeNpmToken}\n`);

      expect(execFileSync("git", ["ls-files"], { cwd: fixture.dir, encoding: "utf-8" })).toBe("");
      expect(packedPaths(fixture.dir)).toContain("connectors/acme/yarn.lock");

      const guard = runGuard(fixture.dir);

      expect(guard.status).toBe(1);
      expect(guard.stderr).toContain("connectors/acme/yarn.lock");
      expect(guard.stderr).toContain("literal-npm-token");
      expect(guard.stderr).not.toContain(fakeNpmToken);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test("fails on a binary lockfile instead of silently skipping it", () => {
    const fixture = makeFixture(["connectors/"]);
    try {
      fixture.write("connectors/acme/index.ts", "export const acme = 1;\n");
      // Real bun.lockb is binary, so its resolved registry URLs — credentials
      // and all — are unreadable to a text scan. Unreadable is not clean.
      fixture.write("connectors/acme/bun.lockb", Buffer.from([0x62, 0x75, 0x6e, 0x00, 0x01, 0x02, 0x00, 0xff]));

      const guard = runGuard(fixture.dir);

      expect(guard.status).toBe(1);
      expect(guard.stderr).toContain("connectors/acme/bun.lockb");
      expect(guard.stderr).toContain("unscannable-package-manager-file");
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test("reports a clean tree when nothing package-manager-shaped carries a credential", () => {
    const fixture = makeFixture(["connectors/"]);
    try {
      fixture.write("connectors/acme/index.ts", `// ${fakeGithubToken} is not a package-manager file\n`);
      fixture.write("connectors/acme/yarn.lock", "# yarn lockfile v1\n");

      const guard = runGuard(fixture.dir);

      expect(guard.status).toBe(0);
      expect(guard.stdout).toContain("Package-manager secret guard clean");
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test("the published files list keeps per-connector lockfiles, env files and local tool output out of the tarball", () => {
    const excluded = [
      "connectors/acme/bun.lock",
      "connectors/acme/bun.lockb",
      "connectors/acme/yarn.lock",
      "connectors/acme/pnpm-lock.yaml",
      "connectors/acme/package-lock.json",
      "connectors/acme/npm-shrinkwrap.json",
      "connectors/acme/.env",
      "connectors/acme/.env.local",
      "connectors/acme/.env.production",
      "connectors/acme/.env.staging",
      "connectors/acme/.test-home/install-cache.bin",
      "connectors/acme/.test-home/.env.example",
      "connectors/acme/node_modules/dep/.env.example",
      "connectors/acme/.codewith/session.json",
      "connectors/acme/.takumi/session.json",
      "connectors/acme/.connectors/installed.json",
      "connectors/acme/.playwright-mcp/trace.json",
    ];
    // `.env.example` documents a connector's required variables and has always
    // shipped. The `.env.*` denial must not take it with it.
    const included = ["connectors/acme/index.ts", "connectors/acme/.env.example"];
    // The real allowlist, so this fails if a negation is dropped from package.json.
    const fixture = makeFixture(repoPackageJson.files);
    try {
      for (const path of [...included, ...excluded]) fixture.write(path, "sentinel\n");

      const packed = packedPaths(fixture.dir);

      for (const path of included) expect(packed).toContain(path);
      expect(packed.filter((path) => excluded.includes(path))).toEqual([]);
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  test("the packed-file scan runs after build and tests, where the packed artifacts exist", () => {
    // `lastIndexOf`, so an extra cheap early invocation stays allowed as long as
    // the packed-file scan is the last thing that runs before the tarball.
    const prepublish = repoPackageJson.scripts.prepublishOnly ?? "";
    const guardAt = prepublish.lastIndexOf("check:package-secrets");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(prepublish.indexOf("bun run build"));
    expect(guardAt).toBeGreaterThan(prepublish.indexOf("bun test"));

    const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf-8");
    const ciGuardAt = ci.lastIndexOf("run: bun run check:package-secrets");
    expect(ciGuardAt).toBeGreaterThan(-1);
    expect(ciGuardAt).toBeGreaterThan(ci.indexOf("name: Build"));
    expect(ciGuardAt).toBeGreaterThan(ci.indexOf("name: Test"));
  });
});
