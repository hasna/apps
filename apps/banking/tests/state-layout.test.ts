import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSqliteDevStore } from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const legacyGlobalPaths = ["~/.banking", "~/.open-banking"];
const legacyGlobalSegments = [".banking", ".open-banking"];
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function runtimeFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    runtimeFiles(join(path, entry.name))
  );
}

describe("@hasna/banking state layout", () => {
  test("does not read legacy package-global dotdirs or mutate HOME during installation", () => {
    const files = [
      ...runtimeFiles(join(root, "src")),
      ...runtimeFiles(join(root, "scripts")),
      join(root, "package.json"),
    ].filter((path) => /\.(?:json|mjs|ts)$/.test(path));

    for (const path of files) {
      const source = readFileSync(path, "utf8");
      for (const legacySegment of legacyGlobalSegments) {
        expect(source, `${path} must not read a ${legacySegment} home entry`).not.toContain(
          legacySegment,
        );
      }
    }

    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      files?: string[];
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.postinstall).toBeUndefined();
    expect(packageJson.files).not.toContain("scripts/postinstall.ts");
    expect(existsSync(join(root, "scripts", "postinstall.ts"))).toBe(false);
  });

  test("keeps the default dev store in memory without creating a project dotdir", () => {
    const home = mkdtempSync(join(tmpdir(), "banking-state-layout-"));
    tempDirs.push(home);
    const previousHome = process.env.HOME;
    process.env.HOME = home;

    try {
      createSqliteDevStore();
      expect(readdirSync(home)).toEqual([]);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }

    const ignored = readFileSync(join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(ignored).not.toContain(".banking");
    expect(ignored).not.toContain(".open-banking");
  });

  test("documents the audited global and project-local path policy", () => {
    const policyPath = join(root, "docs", "STATE_LAYOUT.md");
    expect(existsSync(policyPath)).toBe(true);
    if (!existsSync(policyPath)) return;

    const policy = readFileSync(policyPath, "utf8");
    expect(policy).toContain("~/.hasna/banking");
    for (const legacyPath of legacyGlobalPaths) {
      expect(policy).toContain(legacyPath);
    }
    expect(policy).toContain("No package-owned project-local dotdir");

    const readme = readFileSync(join(root, "README.md"), "utf8");
    expect(readme).toContain("docs/STATE_LAYOUT.md");
  });
});
