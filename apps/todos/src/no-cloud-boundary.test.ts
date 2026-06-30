import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import packageJson from "../package.json";
import sdkPackageJson from "../sdk/package.json";

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
    expect(packageJson.workspaces).toContain("dashboard");
    expect(packageJson.bin).not.toHaveProperty("todos-remote");
    expect(packageJson.exports).not.toHaveProperty("./remote");
    expect(sdkPackageJson.repository.url).toBe("https://github.com/hasna/todos.git");
    expect(sdkPackageJson.homepage).toBe("https://github.com/hasna/todos");
    expect(sdkPackageJson.bugs.url).toBe("https://github.com/hasna/todos/issues");

    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(sdkPackageJson.dependencies ?? {}),
      ...Object.keys(sdkPackageJson.devDependencies ?? {}),
    ];
    for (const forbidden of ["aws", "cloudflare", "stripe", "cerebras", "hasnastudio", "platform-todos"]) {
      expect(dependencyNames.some((name) => name.toLowerCase().includes(forbidden))).toBe(false);
    }
  });

  test("local plan artifacts stay under project .hasna storage with no remote provider hooks", () => {
    const source = readFileSync(join(root, "src", "lib", "plan-artifacts.ts"), "utf8");
    expect(source).toContain('".hasna", "todos", "plans"');
    expect(source).not.toMatch(/HASNA_TODOS_STORAGE_MODE|TODOS_STORAGE_MODE|S3|Postgres|fetch\(|https?:\/\//i);
  });

  test("public docs, package surfaces, and scripts stay Bun-only and secret-free", () => {
    const offenders: string[] = [];
    const forbidden = [
      /github\.com\/hasna\/open-todos/i,
      /\bopen-todos\b/i,
      /npm install -g @hasna\/todos/i,
      /npm install @hasna\/todos-sdk/i,
      /bun add -g @hasna\/todos/i,
    ];
    const secretLike = [
      /AKIA[0-9A-Z]{16}/,
      /ASIA[0-9A-Z]{16}/,
      /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
      /[A-Za-z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)[A-Za-z0-9_]*\s*=\s*['"][^'"]{12,}/,
    ];

    for (const file of packageSurfaceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) offenders.push(`${relative(root, file)}: ${pattern}`);
      }
      for (const pattern of secretLike) {
        if (pattern.test(text)) offenders.push(`${relative(root, file)}: secret-like ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("bun install -g @hasna/todos");
    expect(readFileSync(join(root, "src/cli/commands/agent-commands.ts"), "utf8")).toContain(
      "bun install -g @hasna/todos@latest",
    );
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

function packageSurfaceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if ([".git", ".claude", ".codewith", ".takumi", ".venv", "node_modules", "dist", "coverage", "dashboard"].includes(entry)) {
      return [];
    }
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return packageSurfaceFiles(path);
    if (!/\.(md|json|ya?ml|sh|ts|tsx)$/.test(path)) return [];
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return [];
    if (
      path.endsWith("src/lib/redaction.ts") ||
      path.endsWith("src/lib/secret-redaction.ts") ||
      path.endsWith("src/lib/public-release-gate.ts")
    ) {
      return [];
    }
    return [path];
  });
}
