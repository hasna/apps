# No-Cloud Release Gate Template

Use this template in every `open-[name]` repo before publish/update. Keep the
repo-specific allowlist small and explicit.

For cross-repo publish sequencing, use
`docs/open-package-no-cloud-release-train.md`.

## Test Shape

Create a test such as `src/no-cloud-boundary.test.ts` or
`tests/no_cloud_boundary.py` that checks:

1. package metadata has no runtime dependency on `@hasna/cloud`, `open-cloud`,
   or private `platform-*` packages
2. public bins/exports do not expose hosted-only entrypoints
3. source docs and built output do not contain private platform markers,
   private API URLs, or secret-like assignments
4. a local create/read/update path succeeds with outbound network disabled
5. remote/hosted mode requires explicit env/config and can be mocked

## TypeScript/Bun Skeleton

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const forbiddenPackageParts = [
  "@hasna/cloud",
  "open-cloud",
  "platform-",
  "hasnastudio",
];

const forbiddenText = [
  /@hasna\/cloud/i,
  /\bopen-cloud\b/i,
  /\bplatform-[a-z0-9-]+\b/i,
  /https:\/\/api\.[a-z0-9.-]*hasna/i,
  /\b[A-Z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*["'][^"']{12,}/,
];

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function collectText(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "dist", "coverage", ".tmp"].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectText(path);
    if (!/\.(ts|tsx|js|json|md|yml|yaml|sh)$/.test(entry.name)) return [];
    if (entry.name.endsWith(".test.ts")) return [];
    return [{ path, text: readFileSync(join(root, path), "utf8") }];
  });
}

describe("OSS no-cloud boundary", () => {
  test("package metadata has no cloud/runtime wrapper dependency", () => {
    const pkg = readJson("package.json");
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.peerDependencies as Record<string, string> | undefined),
      ...(pkg.optionalDependencies as Record<string, string> | undefined),
    };

    for (const name of Object.keys(deps)) {
      expect(forbiddenPackageParts.some((part) => name.toLowerCase().includes(part))).toBe(false);
    }
  });

  test("public text surfaces stay local-first and secret-free", () => {
    for (const file of collectText(".")) {
      for (const pattern of forbiddenText) {
        expect(file.text, `${file.path} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test("local default path does not use network", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("unexpected network call in local mode");
    }) as typeof fetch;

    try {
      // Repo-specific smoke: create/read/update a local record or render local CLI help.
      expect(true).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

## Release Smoke

Add repo-native commands for the package:

```bash
bun run typecheck
bun test
bun run build
npm pack --dry-run --json --ignore-scripts
<cli> --version
<cli> --help
<mcp-cli> --help
```

The help/version paths must exit before binding ports, opening browsers, or
calling hosted APIs.
