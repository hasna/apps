import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:ts|js)$/.test(entry.name) ? [path] : [];
  });
}

describe("Domains is the sole provider authority", () => {
  test("Shortlinks contains no registrar, DNS, or Worker-binding implementation", () => {
    const root = join(import.meta.dir, "..");
    const forbidden = [
      /api\.cloudflare\.com/,
      /@aws-sdk\/client-route-53/,
      /route53domains/i,
      /\/workers\/domains/,
      /from\s+["'][^"']*(?:cloudflare|route53|registrar|domains-cli)["']/i,
    ];
    const violations: string[] = [];
    for (const file of sourceFiles(root)) {
      if (file.endsWith("domains-boundary.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) violations.push(`${file}: ${pattern}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("obsolete provider implementations and packaged Worker assets are absent", () => {
    const packageRoot = join(import.meta.dir, "..");
    for (const relative of [
      "src/cloudflare.ts",
      "src/cloudflare.test.ts",
      "src/domains-cli.ts",
      "cloudflare/shortlinks.js",
      "cloudflare/wrangler.example.toml",
    ]) {
      expect(existsSync(join(packageRoot, relative))).toBe(false);
    }
  });
});
