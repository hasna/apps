/**
 * Member scaffold — standard-adherence suite.
 *
 * `tooling/member-scaffold/generate-member.ts` is how a new `@hasna/<name>`
 * member is created, so a defect in it is re-created for every future member.
 * Two such defects shipped and were repaired by hand on each generated member
 * before this gate existed:
 *
 *   1. **Malformed changeset** — the generator emitted the package entry ABOVE
 *      the opening `---` delimiter. Every generated member therefore carried a
 *      pending changeset that `test/versioning/helpers.ts#parseChangesetFrontmatter`
 *      rejects with "missing opening frontmatter delimiter", and
 *      `bun run test:versioning` is a hard gate.
 *
 *   2. **Bin path vs build output** — `package.json#bin` declared
 *      `dist/{cli,mcp,serve}/index.js` while the build ran
 *      `bun build src/<kind>.ts --outdir dist/<kind>`, which emits
 *      `dist/<kind>/<kind>.js`. All three declared bins missed the packed
 *      tarball, failing `check-publish-guard` with "declares bin entries that
 *      the tarball does not pack".
 *
 * This gate runs the REAL generator into a temp directory and parses the
 * product with the versioning suite's own parser, so the two suites cannot
 * drift. The self-test at the bottom proves both assertions actually fire on
 * the pre-fix shape — a guard that cannot fail is not a guard.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { assertChangesetFrontmatter } from "../../../member-scaffold/changeset";
import { parseChangesetFrontmatter } from "../../../../test/versioning/helpers";

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const GENERATOR = path.join(REPO_ROOT, "tooling", "member-scaffold", "generate-member.ts");

/**
 * Remove ONLY a sandbox this file just created, and only after proving it sits
 * under the OS temp root. Every path this gate touches is a fresh `mkdtemp`
 * directory; the assertion keeps that provable rather than assumed, so the
 * cleanup can never widen its blast radius onto a real path.
 */
export function cleanupSandbox(root: string): void {
  const tmpRoot = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(root);
  if (resolved !== tmpRoot && resolved.startsWith(tmpRoot + path.sep)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

/** A bin path `dist/<kind>/index.js` maps to the build entry `src/<kind>/index.ts`. */
export function entryForBinPath(binPath: string): string | null {
  const match = /^dist\/([a-z0-9-]+)\/index\.js$/.exec(binPath);
  return match ? path.posix.join("src", match[1]!, "index.ts") : null;
}

export interface ScaffoldProduct {
  changesetRaw: string;
  binPaths: string[];
  entries: string[];
  manifest: Record<string, unknown>;
  memberDir: string;
}

/** Run the generator into `root` and read back the parts the gates care about. */
export function generateInto(root: string, name = "probe-member"): ScaffoldProduct {
  fs.mkdirSync(path.join(root, ".changeset"), { recursive: true });
  const run = spawnSync(process.execPath, [GENERATOR, name, "probe member", "--out", root], {
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(`generator exited ${run.status}: ${run.stderr || run.stdout}`);
  }
  const memberDir = path.join(root, "apps", name);
  const pkg = JSON.parse(fs.readFileSync(path.join(memberDir, "package.json"), "utf8")) as { bin?: Record<string, string> };
  const entries: string[] = [];
  const stack = [path.join(memberDir, "src")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, dirent.name);
      if (dirent.isDirectory()) stack.push(p);
      else entries.push(path.relative(memberDir, p));
    }
  }
  return {
    changesetRaw: fs.readFileSync(path.join(root, ".changeset", `${name}-bootstrap.md`), "utf8"),
    binPaths: Object.values(pkg.bin ?? {}),
    entries: entries.sort(),
    manifest: JSON.parse(fs.readFileSync(path.join(memberDir, "hasna.contract.json"), "utf8")) as Record<string, unknown>,
    memberDir,
  };
}

/**
 * The manifest shapes a generated member must NOT carry (fleet-alignment
 * rulings d/f, 2026-09-11). Before this gate the template seeded
 * `storage.backend: sqlite`, a `sqlitePath` and `authMode: local-only` on the
 * CLI and MCP surfaces, so every new member was born as a silent local store.
 */
export function forbiddenManifestShapes(manifest: Record<string, unknown>): string[] {
  const out: string[] = [];
  const storage = (manifest.storage ?? {}) as Record<string, unknown>;
  if (storage.backend === "sqlite" || storage.backend === "json") out.push(`storage.backend is ${String(storage.backend)} (must be postgresql)`);
  if (Array.isArray(storage.engines) && storage.engines.includes("sqlite")) out.push("storage.engines includes sqlite");
  if (typeof storage.sqlitePath === "string") out.push(`storage.sqlitePath is set (${storage.sqlitePath})`);
  for (const surface of (manifest.serviceSurfaces ?? []) as Array<Record<string, unknown>>) {
    if (surface.authMode === "local-only") out.push(`serviceSurfaces[${String(surface.name)}].authMode is local-only (must be api-key)`);
  }
  return out;
}

describe("standard-adherence: member scaffold", () => {
  test("the generated changeset opens with '---' and parses under the versioning suite's parser", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-scaffold-changeset-"));
    try {
      const product = generateInto(root);
      // The versioning suite's own parser is the contract — importing it here
      // is what keeps the two suites from drifting apart.
      const parsed = parseChangesetFrontmatter(product.changesetRaw, "probe-member-bootstrap.md");
      expect(parsed.packages.get("@hasna/probe-member")).toBe("minor");
      expect(parsed.body.length).toBeGreaterThan(0);
    } finally {
      cleanupSandbox(root);
    }
  });

  test("every declared bin path has the source entry its build step compiles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-scaffold-bins-"));
    try {
      const product = generateInto(root);
      expect(product.binPaths.length).toBeGreaterThan(0);
      const missing = product.binPaths.filter((binPath) => {
        const entry = entryForBinPath(binPath);
        return entry === null || !product.entries.includes(entry);
      });
      expect(
        missing,
        `declared bin paths with no matching src/<kind>/index.ts entry (the build would emit dist/<kind>/<kind>.js, so the tarball packs no such bin): ${missing.join(", ")}`,
      ).toEqual([]);
    } finally {
      cleanupSandbox(root);
    }
  });

  test("the generated manifest is hosted-shaped: no sqlite backend, no sqlitePath, no local-only surface", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-scaffold-manifest-"));
    try {
      const product = generateInto(root);
      expect(forbiddenManifestShapes(product.manifest)).toEqual([]);
      expect(product.manifest.class).toBe("service");
    } finally {
      cleanupSandbox(root);
    }
  });

  test("the generated member passes the in-tree `contracts repo-conformance` (the kit this tree ships, not a registry pin)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "standard-scaffold-conformance-"));
    try {
      // Single-word name: every real member is one word, and the kit's own
      // storage.envPrefix rule is not satisfiable for a hyphenated name
      // (schema regex ^HASNA_[A-Z][A-Z0-9]*_$ vs the derived HASNA_<A_B>_ —
      // an @hasna/contracts inconsistency owned by the contracts lane).
      const product = generateInto(root, "probemember");
      const cli = path.join(REPO_ROOT, "apps", "contracts", "src", "cli", "index.ts");
      const run = spawnSync(process.execPath, [cli, "repo-conformance", product.memberDir], { encoding: "utf8", cwd: REPO_ROOT, timeout: 120_000 });
      const out = `${run.stdout}\n${run.stderr}`;
      const verdict = out.split("\n").find((l) => /^(ok|fail) hasna\.service_contract\.v1/.test(l.trim()))?.trim() ?? "";
      expect(verdict, out.slice(0, 2000)).toStartWith("ok ");
    } finally {
      cleanupSandbox(root);
    }
  }, 180_000);

  test("self-test: the manifest-shape guard fires on the pre-fix template shape and stays silent on the hosted shape", () => {
    const preFix = {
      storage: { backend: "sqlite", engines: ["sqlite", "postgresql"], sqlitePath: "~/.hasna/x/x.db" },
      serviceSurfaces: [{ name: "cli", authMode: "local-only" }, { name: "mcp", authMode: "local-only" }, { name: "http-api", authMode: "api-key" }],
    };
    expect(forbiddenManifestShapes(preFix)).toHaveLength(5);
    const hosted = {
      storage: { backend: "postgresql", engines: ["postgresql"] },
      serviceSurfaces: [{ name: "cli", authMode: "api-key" }, { name: "mcp", authMode: "api-key" }],
    };
    expect(forbiddenManifestShapes(hosted)).toEqual([]);
  });

  test("self-test: the guard fires on the pre-fix changeset shape and stays silent on the fixed one", () => {
    const malformed = `"@hasna/probe-member": minor
---

Bootstrap probe-member.
`;
    expect(() => assertChangesetFrontmatter(malformed, "probe.md")).toThrow(/opening '---' frontmatter delimiter/);

    const unterminated = `---
"@hasna/probe-member": minor

Bootstrap probe-member.
`;
    expect(() => assertChangesetFrontmatter(unterminated, "probe.md")).toThrow(/closing '---' frontmatter delimiter/);

    const emptyBody = `---
"@hasna/probe-member": minor
---
`;
    expect(() => assertChangesetFrontmatter(emptyBody, "probe.md")).toThrow(/empty description/);

    const fixed = `---
"@hasna/probe-member": minor
---

Bootstrap probe-member.
`;
    expect(() => assertChangesetFrontmatter(fixed, "probe.md")).not.toThrow();
    expect(parseChangesetFrontmatter(fixed, "probe.md").packages.get("@hasna/probe-member")).toBe("minor");
  });

  test("self-test: the bin-path mapping rejects the pre-fix 'src/<kind>.ts' shape", () => {
    expect(entryForBinPath("dist/cli/index.js")).toBe("src/cli/index.ts");
    expect(entryForBinPath("dist/serve/index.js")).toBe("src/serve/index.ts");
    // A member whose build runs `bun build src/cli.ts --outdir dist/cli`
    // declares this bin and produces dist/cli/cli.js — no entry at the mapped
    // path, so the check above fires.
    expect(entryForBinPath("dist/cli/index.js")).not.toBe("src/cli.ts");
    expect(entryForBinPath("dist/server/bin.js")).toBeNull();
  });
});
