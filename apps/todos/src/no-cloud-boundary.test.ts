import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import packageJson from "../package.json";
import sdkPackageJson from "../sdk/package.json";
import { TODOS_AI_RUNTIME_SPECIFIER } from "./ai.js";

const root = join(import.meta.dir, "..");
const runtimeSourceForbidden = [
  /https:\/\/api\.cerebras\.ai/i,
  /\bCEREBRAS_API_KEY\b/,
  /https?:\/\/(?:[^/\s]+\.)?groq\.com\b/i,
  /\bGROQ_API_KEY\b/,
  /["']@ai-sdk(?:\/[^"']*)?["']/i,
  /["'](?:groq|groq-sdk)(?:\/[^"']*)?["']/i,
  /\bTODOS_API_URL\b/,
  /\bTODOS_MODE\b/,
  /\bAWS_[A-Z0-9_]+\b/,
  /\bCLOUDFLARE_[A-Z0-9_]+\b/,
  /\bSTRIPE_[A-Z0-9_]+\b/,
  /hasnastudio/i,
  /platform-todos/i,
  /telemetry/i,
];

describe("OSS no-cloud boundary", () => {
  test("runtime source has no hosted provider or private platform hooks", () => {
    const offenders: string[] = [];

    // Narrow, named exemptions. Each names ONE file and ONE pattern and says why the
    // match is the opposite of the thing the guard is looking for. Never widen a pattern
    // to make a file pass; add a line here or fix the file.
    const exempt = new Map<string, { pattern: RegExp; reason: string }[]>([
      [
        "src/testing.ts",
        [
          {
            pattern: /\bTODOS_API_URL\b/,
            reason:
              "the scrub list must NAME the legacy hosted-routing aliases in order to blank them; " +
              "this module exists to keep tests off a hosted store, not to reach one",
          },
          {
            pattern: /\bTODOS_MODE\b/,
            reason:
              "the REMOVED_TODOS_ENV_KEYS list must NAME the retired storage-mode variables in " +
              "order to delete them from a test environment; the resolver never reads them",
          },
        ],
      ],
      [
        "src/cli/stage-a.ts",
        [
          {
            pattern: /\bTODOS_API_URL\b/,
            reason:
              "the admitted-local redaction must NAME the API-pair aliases in order to blank them; " +
              "it neutralizes hosted routing, it does not reach it",
          },
        ],
      ],
    ]);

    for (const file of runtimeSourceFiles(join(root, "src"))) {
      const text = readFileSync(file, "utf8");
      const rel = relative(root, file);
      const allowed = exempt.get(rel) ?? [];
      for (const pattern of runtimeSourceForbidden) {
        if (!pattern.test(text)) continue;
        if (allowed.some((entry) => entry.pattern.source === pattern.source)) continue;
        offenders.push(`${rel}: ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("published package metadata stays public and local-only", () => {
    expect(packageJson.name).toBe("@hasna/todos");
    expect(packageJson.publishConfig).toMatchObject({ access: "public" });
    expect(packageJson.repository.url).toBe("https://github.com/hasna/todos.git");
    expect(packageJson.workspaces).toContain("ai");
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

    const rootDependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ].map((name) => name.toLowerCase());
    expect(rootDependencyNames.some(isForbiddenRootAiDependency)).toBe(false);
  });

  test("AI isolation guard fires on blocked source and dependency shapes", () => {
    for (const source of [
      'fetch("https://api.groq.com/openai/v1/chat/completions")',
      "process.env.GROQ_API_KEY",
      'import { generateText } from "@ai-sdk/groq"',
      'const sdk = require("@ai-sdk/openai")',
      'import client from "groq"',
      'const client = require("groq-sdk/resources/chat")',
    ]) {
      expect(runtimeSourceForbidden.some((pattern) => pattern.test(source))).toBe(true);
    }
    expect(runtimeSourceForbidden.some(
      (pattern) => pattern.test('import("@hasna/todos-ai/runtime")'),
    )).toBe(false);

    for (const dependency of ["@ai-sdk", "@ai-sdk/groq", "@ai-sdk/openai", "groq", "groq-sdk"]) {
      expect(isForbiddenRootAiDependency(dependency)).toBe(true);
    }
    expect(isForbiddenRootAiDependency("@hasna/todos-ai")).toBe(false);
  });

  test("keeps the optional AI implementation behind a provider-neutral companion boundary", () => {
    expect(TODOS_AI_RUNTIME_SPECIFIER).toBe("@hasna/todos-ai/runtime");

    const rootDependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
    ];
    expect(rootDependencyNames).not.toContain("@hasna/todos-ai");

    const contract = readFileSync(join(root, "docs", "ai-contract.md"), "utf8");
    expect(contract).toContain("provider-neutral host contract");
    expect(contract).toContain("@hasna/todos-ai/runtime");
    expect(contract).not.toMatch(/api\.groq\.com|GROQ_API_KEY|@ai-sdk|@ai-sdk\/groq|\bgroq\b/i);
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
    if ([".git", ".claude", ".codewith", ".hasna", ".takumi", ".venv", "node_modules", "dist", "coverage"].includes(entry)) {
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

function isForbiddenRootAiDependency(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "@ai-sdk" ||
    normalized.startsWith("@ai-sdk/") ||
    normalized.includes("groq");
}
