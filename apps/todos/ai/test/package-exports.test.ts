import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

interface PackageManifest {
  name: string;
  exports: Record<string, unknown>;
  dependencies: Record<string, string>;
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

async function run(command: string[]): Promise<{
  exitCode: number;
  stderr: string;
}> {
  const process = Bun.spawn(command, {
    cwd: packageRoot,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe("built package exports", () => {
  test("root workspace install provisions every runtime dependency", async () => {
    const rootManifest = await Bun.file(
      new URL("../../package.json", import.meta.url),
    ).json() as { workspaces?: string[] };
    const manifest = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json() as PackageManifest;

    expect(rootManifest.workspaces).toContain("ai");
    for (const dependency of Object.keys(manifest.dependencies)) {
      expect(Bun.resolveSync(dependency, packageRoot)).toBeString();
    }
  });

  test("imports every declared export with supported Node", async () => {
    const build = await run(["bun", "run", "build"]);
    expect(build.exitCode).toBe(0);

    const manifest = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json() as PackageManifest;

    for (const exportPath of Object.keys(manifest.exports)) {
      const specifier = exportPath === "."
        ? manifest.name
        : `${manifest.name}/${exportPath.slice(2)}`;
      const imported = await run([
        "node",
        "--input-type=module",
        "--eval",
        [
          "const loaded = await import(process.argv[1]);",
          "if (Object.keys(loaded).length === 0) process.exit(2);",
          "if (Object.values(loaded).some(value => value === undefined)) process.exit(3);",
        ].join(" "),
        specifier,
      ]);

      expect(imported.exitCode).toBe(0);
      expect(imported.stderr).toBe("");
    }
  }, 30_000);
});
