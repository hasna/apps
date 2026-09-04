import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const fixtureParent = join(packageRoot, ".tmp");
await mkdir(fixtureParent, { recursive: true });
const fixtureRoot = await mkdtemp(join(fixtureParent, "package-consumer-"));

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("published package consumer contract", () => {
  test("a clean Bun project installs the packed package without root-only patch metadata", async () => {
    const build = Bun.spawnSync(["bun", "run", "build:bundles"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);

    const pack = Bun.spawnSync(
      [
        "bun",
        "pm",
        "pack",
        "--ignore-scripts",
        "--quiet",
        "--destination",
        fixtureRoot,
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(pack.exitCode, pack.stderr.toString()).toBe(0);
    const archiveName = (await readdir(fixtureRoot)).find((name) => name.endsWith(".tgz"));
    expect(archiveName).toBeDefined();

    const consumerRoot = join(fixtureRoot, "consumer");
    await mkdir(consumerRoot);
    await Bun.write(
      join(consumerRoot, "package.json"),
      JSON.stringify({ name: "contacts-consumer-contract", private: true }),
    );
    const install = Bun.spawnSync(
      ["bun", "add", join(fixtureRoot, archiveName!), "--ignore-scripts"],
      { cwd: consumerRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(install.exitCode, install.stderr.toString()).toBe(0);

    const installedManifest = JSON.parse(
      await readFile(join(consumerRoot, "node_modules/@hasna/contacts/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(installedManifest.patchedDependencies).toBeUndefined();
    const installedRoot = join(consumerRoot, "node_modules/@hasna/contacts");
    for (const bundle of ["dist/cli/index.js", "dist/server/index.js", "dist/mcp/index.js"]) {
      const contents = await readFile(join(installedRoot, bundle), "utf8");
      expect(contents).not.toMatch(/(?:require\(|from\s+)["']fast-uri["']/);
      expect(contents).not.toContain('from "bun:sqlite"');
      expect(contents).not.toContain("class LocalStore");
      expect(contents).not.toContain("CREATE TABLE contacts");
    }
    const version = Bun.spawnSync(
      ["bun", join(installedRoot, "dist/server/index.js"), "--version"],
      {
        cwd: consumerRoot,
        env: {
          ...process.env,
          CONTACTS_NO_OPEN: "true",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(version.exitCode, version.stderr.toString()).toBe(0);
    expect(typeof installedManifest.version).toBe("string");
    expect(version.stdout.toString().trim()).toBe(installedManifest.version);
    expect(version.stderr.toString()).not.toContain("Contacts MCP server running");
  }, 60_000);
});
