import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

describe("published package", () => {
  test("builds every exported entry point before packing", () => {
    rmSync(join(REPO_ROOT, "dist"), { recursive: true, force: true });

    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--silent"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error(
        `\`npm pack --dry-run --json\` failed (status ${result.status}): ${
          result.stderr || result.error?.message
        }`,
      );
    }

    const jsonStart = result.stdout.lastIndexOf("\n[");
    const output = jsonStart === -1 ? result.stdout : result.stdout.slice(jsonStart + 1);
    const packed = JSON.parse(output) as Array<{
      files: Array<{ path: string }>;
    }>;
    const paths = packed[0]?.files.map(({ path }) => path) ?? [];
    const packageJson = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    ) as {
      bin: { capacity: string };
      exports: Record<string, { import: string; types: string }>;
    };

    expect(paths).toContain(packageJson.bin.capacity.replace(/^\.\//, ""));
    for (const entryPoint of Object.values(packageJson.exports)) {
      expect(paths).toContain(entryPoint.import.replace(/^\.\//, ""));
      expect(paths).toContain(entryPoint.types.replace(/^\.\//, ""));
    }
  }, 30_000);
});
