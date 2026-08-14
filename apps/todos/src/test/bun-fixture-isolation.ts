import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a temp root for tests that spawn Bun from inside fixture directories.
 *
 * Bun 1.3 parses package.json files from ancestor directories before executing a
 * script. On this fleet `/tmp/package.json` belongs to unrelated work and can
 * emit warnings into otherwise clean child-process stderr. These roots are
 * created under the OS temp directory to stay outside this repository's
 * dependency ancestry, then immediately get a local package sentinel so the
 * fixture has an explicit package root of its own before callers spawn Bun.
 */
export function createBunPackageIsolatedTempDir(prefix: string, options: { parent?: string } = {}): string {
  const parent = options.parent ?? tmpdir();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, prefix));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    private: true,
    name: "todos-test-fixture",
    version: "0.0.0",
  }) + "\n");
  return root;
}

export type BunExternalAncestorWarningProjection = {
  stderr: string;
  removed: string[];
};

function splitLinesKeepingEndings(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove the unrelated Bun warning injected by the fleet temp-root ancestor.
 *
 * The warning is not emitted by the fixture under test: it comes from Bun
 * traversing to `${os.tmpdir()}/package.json`, which belongs to unrelated
 * platform-alumia work on this station. This projection is intentionally
 * test-only, narrow, and byte-preserving for every non-matching stderr segment.
 */
export function projectExternalBunDuplicatePackageWarning(stderr: string): BunExternalAncestorWarningProjection {
  const tempPackageJson = join(tmpdir(), "package.json");
  const atTempPackage = new RegExp(`^\\s+at ${escapeRegExp(tempPackageJson)}:\\d+:\\d+\\n?$`);
  const lines = splitLinesKeepingEndings(stderr);
  const kept: string[] = [];
  const removed: string[] = [];

  for (let index = 0; index < lines.length;) {
    const source = lines[index] ?? "";
    const pointer = lines[index + 1] ?? "";
    const diagnostic = lines[index + 2] ?? "";
    const location = lines[index + 3] ?? "";
    const trailingBlank = lines[index + 4] ?? "";

    const matchesExternalTodosWarning =
      /^\d+ \| .*"@hasna\/todos".*\n?$/.test(source) &&
      /^\s*\^\n?$/.test(pointer) &&
      diagnostic === "warn: Duplicate key \"@hasna/todos\" in object literal\n" &&
      atTempPackage.test(location);

    if (matchesExternalTodosWarning) {
      let block = source + pointer + diagnostic + location;
      index += 4;
      if (trailingBlank === "\n") {
        block += trailingBlank;
        index += 1;
      }
      removed.push(block);
      continue;
    }

    kept.push(source);
    index += 1;
  }

  return { stderr: kept.join(""), removed };
}
