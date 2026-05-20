import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import packageJson from "../package.json";

const root = join(import.meta.dir, "..");

describe("OSS no-cloud boundary", () => {
  test("runtime source has no hosted provider or private platform hooks", () => {
    const offenders: string[] = [];
    const forbidden = [
      /https:\/\/api\.cerebras\.ai/i,
      /\bCEREBRAS_API_KEY\b/,
      /\bTODOS_API_URL\b/,
      /\bTODOS_MODE\b/,
      /\bAWS_[A-Z0-9_]+\b/,
      /\bCLOUDFLARE_[A-Z0-9_]+\b/,
      /\bSTRIPE_[A-Z0-9_]+\b/,
      /hasnastudio/i,
      /platform-todos/i,
      /telemetry/i,
    ];

    for (const file of runtimeSourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) offenders.push(`${relative(root, file)}: ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("published package metadata stays public and local-only", () => {
    expect(packageJson.name).toBe("@hasna/todos");
    expect(packageJson.publishConfig).toMatchObject({ access: "public" });
    expect(packageJson.repository.url).toBe("https://github.com/hasna/todos.git");
    expect(packageJson.bin).not.toHaveProperty("todos-remote");
    expect(packageJson.exports).not.toHaveProperty("./remote");

    const dependencyNames = Object.keys(packageJson.dependencies ?? {});
    for (const forbidden of ["aws", "cloudflare", "stripe", "cerebras", "hasnastudio", "platform-todos"]) {
      expect(dependencyNames.some((name) => name.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});

function runtimeSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return runtimeSourceFiles(path);
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return [];
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return [];
    return [path];
  });
}
