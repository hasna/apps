import { describe, expect, test } from "bun:test";
import { builtinModules } from "node:module";

const bareRuntimeImport =
  /(?:from\s+|require\()\s*["'](?:pg|@hasna\/contracts(?:\/[^"']*)?)["']/;

const forbiddenCloudRuntimeMarkers = [
  'from "bun:sqlite"',
  'require("bun:sqlite")',
  "contacts.db",
  ".hasna/contacts",
  "@modelcontextprotocol/sdk",
  "node_modules/ajv/",
  "vendor/fast-uri/",
] as const;

describe("standalone server bundle", () => {
  test("contains every remote runtime dependency", async () => {
    const build = Bun.spawn(
      ["bun", "run", "scripts/build-bundles.ts", "--standalone-server"],
      { stdout: "pipe", stderr: "pipe" },
    );

    const [exitCode, stderr] = await Promise.all([
      build.exited,
      new Response(build.stderr).text(),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const bundle = await Bun.file("dist/server/cloud-index.js").text();
    expect(bundle).not.toMatch(bareRuntimeImport);
    for (const marker of forbiddenCloudRuntimeMarkers) {
      expect(bundle).not.toContain(marker);
    }

    // A scratch image has no package manager or node_modules. Dynamic CommonJS
    // loads of third-party packages would make Bun fetch them at runtime,
    // violating immutable, network-independent production startup. Bundled pg
    // legitimately loads only Bun/Node built-ins through Bun's __require shim.
    const builtins = new Set([
      ...builtinModules,
      ...builtinModules.map((name) => `node:${name}`),
    ]);
    const runtimeRequires = [...bundle.matchAll(/\b_*require\(["']([^"']+)["']\)/g)]
      .map((match) => match[1]!);
    expect(runtimeRequires.length).toBeGreaterThan(0);
    expect(runtimeRequires.filter((name) => !builtins.has(name))).toEqual([]);

    const dockerfile = await Bun.file("Dockerfile").text();
    expect(dockerfile).toContain(
      'CMD ["/usr/local/bin/bun", "--no-install", "dist/server/cloud-index.js"]',
    );
  });
});
