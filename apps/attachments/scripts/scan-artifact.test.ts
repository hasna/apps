import { describe, it, expect } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_KIT_VERSION, packArtifact, scannerCommand, scanPackedArtifact } from "./scan-artifact";

const repoRoot = join(import.meta.dir, "..");

function readText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath: string): Record<string, any> {
  return JSON.parse(readText(relativePath));
}

/** Strip comments so a doc line naming an env API cannot mask a real read of it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Strip a leading range operator so "^0.8.2" and "0.8.2" compare equal. */
function rangeBaseVersion(range: string): string {
  return range.replace(/^[\^~=v]+/, "");
}

/**
 * Scripts reachable from `entry` through the pre/post lifecycle and `bun run` /
 * `npm run` references. Mirrors the graph `@hasna/contracts repo-conformance`
 * walks for its published_artifact_gate check, so the wiring is proven on every
 * `bun run test` and not only when a human remembers to type the conformance
 * CLI.
 */
function scriptsReachedBy(scripts: Record<string, string>, entry: string): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = [entry];
  const enqueue = (name: string | undefined) => {
    if (name && name in scripts) queue.push(name);
  };
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (reached.has(name)) continue;
    reached.add(name);
    enqueue(`pre${name}`);
    enqueue(`post${name}`);
    const body = scripts[name];
    if (!body) continue;
    for (const match of body.matchAll(
      /\b(?:bun|bunx|npm|pnpm|yarn)\s+(?:(?:--\S+|-\w)\s+)*(?:run\s+)?([a-zA-Z0-9_][\w:.-]*)/g,
    )) {
      enqueue(match[1]);
    }
  }
  return reached;
}

describe("scan:artifact release gate", () => {
  it("resolves the pinned scanner from source alone — the module reads no environment", () => {
    // Setting one env name and asserting the argv is unchanged only proves the
    // names we happened to think of; a bypass added under any other name stays
    // green. Assert the invariant the module header claims instead: there is no
    // environment input path at all, so there is nothing to override at publish
    // time.
    const source = stripComments(readText("scripts/scan-artifact.ts"));
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/Bun\.env/);
    expect(source).not.toMatch(/import\.meta\.env/);
    expect(source).not.toMatch(/from\s+["']node:process["']/);

    expect(scannerCommand("/tmp/pkg.tgz")).toEqual([
      "bunx",
      `@hasna/contracts@${CONTRACTS_KIT_VERSION}`,
      "artifact-scan",
      "/tmp/pkg.tgz",
    ]);
  });

  it("keeps prepack and prepublishOnly wired to the declared packed-artifact scan", () => {
    // The deliverable here is the wiring, not the script. Drop `prepack`, or
    // drop `scan:artifact` out of `verify:release`, and the scanner still runs
    // clean in isolation while `bun publish` ships an unscanned artifact.
    const scripts = readJson("package.json").scripts as Record<string, string>;
    const declared = readJson("hasna.contract.json").metadata?.release?.artifactScan?.script;

    expect(declared).toBe("scan:artifact");
    expect(scripts[declared]).toBe("bun scripts/scan-artifact.ts");
    expect(scripts["verify:release"]).toContain("bun run scan:artifact");

    // npm/bun run `prepack` for `pm pack` and `prepublishOnly` for `publish`;
    // a gate reachable from only one of them still has a publish-time hole.
    for (const entry of ["prepack", "prepublishOnly"]) {
      expect(scripts[entry]).toBeString();
      expect([...scriptsReachedBy(scripts, entry)]).toContain(declared);
    }
  });

  it("keeps the scanned dist identical to the dist prepare rebuilds at pack time", () => {
    // npm publish runs prepack (verify:release -> scan) BEFORE prepare. If
    // prepare's rebuild differs from the build that was scanned, the scan
    // covers a dist the publish never ships. Release review P1 (publish-all
    // lane, 2026-08-22): build had no externals while build:js externalized
    // @hasna/events, so the scanned CLI and publish-time CLI differed by
    // 48,349 bytes. Lock one build definition: build carries the externals
    // and build:js delegates to it, so verify:release and prepare reach the
    // exact same dist.
    const scripts = readJson("package.json").scripts as Record<string, string>;
    expect(scripts["build"]).not.toContain("@hasna/events");
    expect(scripts["build:js"]).toBe("bun run build");
    // Both the scan path and the pack-time rebuild path must terminate at the
    // same single build command.
    for (const entry of ["verify:release", "prepare"]) {
      expect([...scriptsReachedBy(scripts, entry)]).toContain("build");
    }
    const buildReached = [...scriptsReachedBy(scripts, "build")];
    expect(buildReached).not.toContain("build:js");
  });

  it("enforces the conformance and release gates in CI, not only on a reviewer's laptop", () => {
    // `contracts repo-conformance` is what checks published_artifact_gate. With
    // no workflow it runs when someone types it, which is not a gate.
    const workflow = readText(".github/workflows/ci.yml");
    expect(workflow).toContain(`bunx @hasna/contracts@${CONTRACTS_KIT_VERSION} repo-conformance .`);
    expect(workflow).toContain("bun test src/core/canonical-client.test.ts");
    expect(workflow).toContain("bun run verify:release");
    // The live-PG gate declared in the contract has to actually execute.
    expect(workflow).toContain("HASNA_ATTACHMENTS_TEST_DATABASE_URL");
    expect(workflow).toContain("ATTACHMENTS_REQUIRE_POSTGRES");
  });

  it("records published tooling and honest application-owned storage provenance", () => {
    expect(readJson("hasna.contract.json").kitVersion).toBe(CONTRACTS_KIT_VERSION);
    expect(readText("src/server-storage/README.md")).toContain("0.8.2");
    expect(readText("src/server-storage/README.md")).toContain("unpublished");
    // Adopted client seam: @hasna/contracts 1.0.2 is a devDependency only —
    // `bun build --target bun` inlines it into dist, so nothing published
    // declares it as a runtime dependency. The scanner pin stays in lockstep.
    expect(rangeBaseVersion(readJson("package.json").devDependencies["@hasna/contracts"])).toBe(
      CONTRACTS_KIT_VERSION,
    );
    expect(readJson("package.json").dependencies?.["@hasna/contracts"]).toBeUndefined();
    // The pinned version must be quarantine-excluded or a fresh install stalls.
    expect(readText("pnpm-workspace.yaml")).toContain(`'@hasna/contracts@${CONTRACTS_KIT_VERSION}'`);
  });

  it("keeps the packed artifact free of @hasna/contracts in runtime deps and declarations", async () => {
    // #1782: the bundler inlines @hasna/contracts into every dist entry, so
    // the published .d.ts files must never import it — a declaration import
    // would break consumers who do not install the devDependency. Assert on
    // the PACKED tarball, not on src: dist is the gate.
    const { workspace, archive } = packArtifact();
    try {
      const extracted = join(workspace, "extracted");
      mkdirSync(extracted, { recursive: true });
      const extract = Bun.spawnSync(["tar", "-xzf", archive, "-C", extracted], { stdout: "pipe", stderr: "pipe" });
      expect(extract.exitCode).toBe(0);
      const walk = (dir: string): string[] => {
        const out: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) out.push(...walk(full));
          else if (entry.isFile()) out.push(full);
        }
        return out;
      };
      const declarations = walk(extracted).filter((path) => path.endsWith(".d.ts"));
      expect(declarations.length).toBeGreaterThan(0);
      // #1782 is about IMPORTS, not prose: a declaration that names the
      // package in a comment is harmless, one that imports it breaks
      // consumers who do not install the devDependency. Match the import
      // shapes tsc can emit (static, dynamic, re-export, reference).
      const importShape = /(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*@hasna\/contracts|["'][^"']*@hasna\/contracts["']\s*(?:;|,)|^\/\/\/\s*<reference\s+[^>]*@hasna\/contracts/m;
      for (const declaration of declarations) {
        expect(readFileSync(declaration, "utf8")).not.toMatch(importShape);
      }
      const packedPkg = JSON.parse(readFileSync(join(extracted, "package", "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(packedPkg.dependencies?.["@hasna/contracts"]).toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("packs the artifact and passes the scan with the pinned kit", () => {
    // Proves the pin actually resolves on the registry: an unpublished version
    // makes bunx exit 1 here, exactly as it would in prepack.
    const { command, output } = scanPackedArtifact();
    expect(command[1]).toBe(`@hasna/contracts@${CONTRACTS_KIT_VERSION}`);
    expect(output).toContain("pass artifact-scan");
    expect(output).toContain("packed_artifact");
  }, 300_000);
});
