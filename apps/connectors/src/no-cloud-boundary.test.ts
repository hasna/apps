import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenPackages = ["@hasna/" + "cloud", "open-" + "cloud", "@hasna/" + "wallets"];

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "bin", ".git"].includes(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    files.push(fullPath);
  }
  return files;
}

describe("no private cloud package boundary", () => {
  test("package metadata and lockfiles do not depend on private cloud packages", () => {
    const metadata = ["package.json", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "README.md"]
      .map((file) => [file, readIfExists(join(repoRoot, file))] as const);
    const offenders = metadata.flatMap(([file, content]) =>
      forbiddenPackages
        .filter((pkg) => content.includes(pkg))
        .map((pkg) => `${file}:${pkg}`)
    );

    expect(offenders).toEqual([]);
  });

  test("runtime source does not import private cloud packages", () => {
    const offenders = sourceFiles(join(repoRoot, "src")).flatMap((file) => {
      const content = readFileSync(file, "utf8");
      return forbiddenPackages
        .filter((pkg) => content.includes(pkg))
        .map((pkg) => `${file.replace(repoRoot + "/", "")}:${pkg}`);
    });

    expect(offenders).toEqual([]);
  });

  test("remote storage surface does not use legacy cloud sync naming", () => {
    const checkedFiles = [
      "README.md",
      "src/cli/commands/sync.ts",
      "src/mcp/server.ts",
      "src/index.ts",
    ];
    const forbidden = [
      "HASNA_CONNECTORS_CLOUD_DATABASE_URL",
      "CONNECTORS_CLOUD_DATABASE_URL",
      "connectors cloud sync",
      "cloud_status",
      "cloud_push",
      "cloud_pull",
      "cloud_sync",
      "cloud-sync",
      "storage_sync",
      "getCloudDatabaseUrl",
    ];
    const offenders = checkedFiles.flatMap((file) => {
      const content = readIfExists(join(repoRoot, file));
      return forbidden
        .filter((term) => content.includes(term))
        .map((term) => `${file}:${term}`);
    });

    expect(offenders).toEqual([]);
  });
});
