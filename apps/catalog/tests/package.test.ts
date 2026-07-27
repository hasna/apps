import { describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";

describe("package lifecycle", () => {
  it("builds distributable files before packing", async () => {
    const packageJson = await Bun.file(
      new URL("../package.json", import.meta.url),
    ).json();
    expect(packageJson.scripts.prepack).toBe("bun run build");

    const projectRoot = new URL("..", import.meta.url);
    await rm(new URL("dist", projectRoot), { recursive: true, force: true });

    const pack = Bun.spawn(["npm", "pack", "--dry-run", "--json"], {
      cwd: projectRoot.pathname,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
      pack.exited,
    ]);

    expect(exitCode, stderr).toBe(0);
    const packJsonStart = stdout.lastIndexOf("\n[");
    expect(packJsonStart, stdout).toBeGreaterThanOrEqual(0);

    const [manifest] = JSON.parse(stdout.slice(packJsonStart + 1)) as Array<{
      files: Array<{ path: string }>;
    }>;
    const packedFiles = manifest.files.map(({ path }) => path);

    expect(packedFiles).toContain("dist/cli/index.js");
    expect(packedFiles).toContain("dist/index.js");
  });
});
