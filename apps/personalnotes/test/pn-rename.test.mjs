// Genuine tests for the "Personal Notes" rename workstream.
//
// These lock in the npm/GitHub identity, the standard bins, the 2-mode README
// story, and the absence of stale product-name / internal-infra leaks. They are
// dependency-free and run under `bun test`.
import { test, expect } from "bun:test";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json"));

test("package identity is the public @hasna/personalnotes core", () => {
  expect(pkg.name).toBe("@hasna/personalnotes");
  expect(pkg.private).toBeUndefined();
  expect(pkg.publishConfig?.access).toBe("public");
  expect(pkg.repository?.url).toContain("github.com/hasna/personalnotes");
  // No stale identity anywhere in the manifest.
  const raw = read("package.json");
  expect(raw).not.toContain("@hasna/notes");
  expect(raw).not.toContain("hasna-notes");
  expect(raw).not.toContain("open-notes");
});

test("standard bins are wired to existing, syntactically valid entrypoints", () => {
  const expected = {
    personalnotes: "cli/personalnotes.mjs",
    "personalnotes-mcp": "mcp/personalnotes-mcp.mjs",
    "personalnotes-serve": "ai-sidecar/server.mjs",
  };
  expect(pkg.bin).toEqual(expected);
  for (const target of Object.values(expected)) {
    const abs = join(ROOT, target);
    expect(existsSync(abs)).toBe(true);
    // Ships in the npm tarball.
    expect(pkg.files.some((f) => target.startsWith(f.replace(/\/$/, "")))).toBe(true);
    // Parses without a syntax error (node --check only parses; it does not
    // resolve imports, unlike `bun --check`).
    execFileSync("node", ["--check", abs]);
  }
});

test("old bin-named entrypoint files no longer exist", () => {
  expect(existsSync(join(ROOT, "cli/hasna-notes.mjs"))).toBe(false);
  expect(existsSync(join(ROOT, "mcp/hasna-notes-mcp.mjs"))).toBe(false);
});

test("CLI and MCP self-identify as Personal Notes / personalnotes", () => {
  const cli = read("cli/personalnotes.mjs");
  expect(cli).toContain("Personal Notes CLI");
  expect(cli).toContain("personalnotes list");
  expect(cli).not.toMatch(/^\s*hasna-notes /m);

  const mcp = read("mcp/personalnotes-mcp.mjs");
  expect(mcp).toContain("name: 'personalnotes'");
  expect(mcp).not.toContain("Hasna Notes");
});

test("README tells exactly the 2-mode story with no dead tiers", () => {
  const readme = read("README.md");
  expect(readme.startsWith("# Personal Notes")).toBe(true);
  expect(readme).toContain("@hasna/personalnotes");
  expect(readme).toContain("Personal Notes Cloud");
  expect(readme).toContain("Host it yourself");
  // No retired product tiers (deployment-doctrine checklist).
  expect(readme.toLowerCase()).not.toContain("byoc");
  expect(readme.toLowerCase()).not.toMatch(/managed[.\s-]cloud/);
  // No stale product/package identity.
  expect(readme).not.toContain("Hasna Notes");
  expect(readme).not.toContain("@hasna/notes");
});

test("no internal-infra leaks in public-facing files", () => {
  const leak = /hasna\.xyz|arn:aws|789877399345|hasna-xyz-infra|hasna\/oss\//;
  for (const p of ["README.md", "CHANGELOG.md", "docs/ui-contracts.md", "package.json"]) {
    expect(read(p)).not.toMatch(leak);
  }
});
