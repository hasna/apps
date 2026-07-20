import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function runBoundaryScan(root: string) {
  return spawnSync("bun", ["run", "scripts/no-private-cloud-boundary.mjs", "--root", root], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function withBoundaryFixture(
  files: Record<string, string>,
  verify: (result: ReturnType<typeof runBoundaryScan>) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "loops-boundary-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    }
    verify(runBoundaryScan(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function sourceFilesUnder(relativeDir: string): string[] {
  const root = join(sourceRoot, relativeDir);
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && extname(path) === ".ts" && !path.endsWith(".test.ts")) files.push(path);
    }
  }

  walk(root);
  return files;
}

describe("public package cloud boundary", () => {
  test("does not ship private hosted implementation details or obvious secrets", () => {
    const result = runBoundaryScan(repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("boundary scan passed");
  });

  test("rejects the internal hosted suffix in source and built package files", () => {
    const hostedSuffix = ["hasna", "xyz"].join(".");
    withBoundaryFixture(
      {
        "src/client.ts": `export const endpoint = "https://api.${hostedSuffix}/v1";`,
        "dist/index.js": `export const endpoint = "HTTPS://LOOPS.${hostedSuffix.toUpperCase()}/v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("src/client.ts: internal hosted domain suffix");
        expect(result.stderr).toContain("dist/index.js: internal hosted domain suffix");
      },
    );
  });

  test("rejects a fully qualified internal hostname with a trailing dot", () => {
    const hostedSuffix = ["hasna", "xyz"].join(".");
    withBoundaryFixture(
      {
        "dist/index.js": `export const endpoint = "https://api.${hostedSuffix}./v1";`,
      },
      (result) => {
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("dist/index.js: internal hosted domain suffix");
      },
    );
  });

  test("allows neutral deployment placeholders and unrelated domains", () => {
    const hostedSuffix = ["hasna", "xyz"].join(".");
    withBoundaryFixture(
      {
        "src/client.ts": [
          'export const example = "https://service.example/v1";',
          'export const placeholder = "https://app.<your-deployment-domain>/v1";',
          `export const unrelated = "https://${hostedSuffix}.example/v1";`,
        ].join("\n"),
        "dist/index.js": 'export const endpoint = "https://your-deployment.example/v1";',
      },
      (result) => {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("boundary scan passed");
      },
    );
  });

  test("loops-api does not import local execution authority", () => {
    const combined = sourceFilesUnder("api")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("bun:sqlite");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/storage/index");
    expect(combined).not.toContain("../lib/storage/sqlite");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../lib/executor");
    expect(combined).not.toContain("../lib/workflow-runner");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("executeClaimedRun");
    expect(combined).not.toContain("runNow");
  });

  test("loops-runner does not import local storage or scheduler authority", () => {
    const combined = sourceFilesUnder("runner")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("bun:sqlite");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/storage/index");
    expect(combined).not.toContain("../lib/storage/sqlite");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("runNow");
  });
});
