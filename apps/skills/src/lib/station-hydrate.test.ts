import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";
import {
  STATION_HYDRATION_MANIFEST_SCHEMA,
  writeStationHydration,
  type StationHydrationResult
} from "./station-hydrate.js";
import { StationSnapshotError, sha256File } from "./station-snapshot.js";

useDefaultTestTimeout();

/**
 * Regression mirror of fleet-resources scripts/hydrate-cache.test.mjs
 * (P-01641 / task 568efaaa): the hydrator's per-(ident, withinIdent) winner
 * selection MUST prefer content over a sync pointer stub. The poisoning shape:
 * an agent home holds a pointer stub (`kind: executable` + the @hasna/skills
 * catalog sentence) whose sha256 the sync-manifest records, while a sibling
 * agent home holds the real content. The content-bearing copy must win even
 * when the manifest hash matches the stub.
 */
const CONTENT_MD =
  "---\nname: merge-pr\ndescription: Merge a pull request\n---\n\n# Merge PR\n\nFull content that must survive hydration, in full.\n";

const STUB_MD =
  "---\nname: merge-pr\ndescription: Merge a pull request\nkind: executable\n---\n\n# Merge PR\n\nThis is an executable skill from the @hasna/skills catalog. It is not run from this\nfile: invoke it with `skills run merge-pr` or through the Skills API. The runnable\nsource lives in the catalog, not in this agent folder.\n";

function sha256Bytes(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A temp corpus-cache pair: the corpus cache is <base>/skills (so the
 * hydration manifest lands at <base>/hydration-<station>.json, mirroring the
 * real ~/.hasna/skills layout) and cleanup removes <base>.
 */
function tempCache(): { base: string; skills: string } {
  const base = tempDir("hydrate-cache-");
  return { base, skills: join(base, "skills") };
}

/**
 * Build a temp snapshot tree:
 *   <root>/resources/<station>/skills/
 *     agent-homes/claude/merge-pr/SKILL.md     <- claudeMd
 *     agent-homes/codewith/merge-pr/SKILL.md   <- codewithMd
 *     sync-manifest.json                       <- records the CODEPATH hash
 */
function buildSnapshot(
  stationId: string,
  claudeMd: string,
  codewithMd: string,
  options: { manifestRecords?: "claude" | "codewith"; extra?: Record<string, string> } = {}
): { root: string; base: string } {
  const root = tempDir("hydrate-snapshot-");
  const base = join(root, "resources", stationId, "skills");
  const claudeDir = join(base, "agent-homes", "claude", "merge-pr");
  const codewithDir = join(base, "agent-homes", "codewith", "merge-pr");
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(codewithDir, { recursive: true });
  writeFileSync(join(claudeDir, "SKILL.md"), claudeMd);
  writeFileSync(join(codewithDir, "SKILL.md"), codewithMd);
  for (const [rel, content] of Object.entries(options.extra ?? {})) {
    const target = join(base, "agent-homes", rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  const recordedAgent = options.manifestRecords ?? "codewith";
  const recordedMd = recordedAgent === "claude" ? claudeMd : codewithMd;
  writeFileSync(
    join(base, "sync-manifest.json"),
    JSON.stringify(
      {
        schema: "hasna.fleet-resources.skills-sync-manifest/v1",
        stationId,
        syncedAt: "2026-08-22T00:00:00.000Z",
        producer: "station-hydrate.test",
        stats: {},
        files: [
          {
            relativePath: "merge-pr/SKILL.md",
            destination: `resources/${stationId}/skills/agent-homes/${recordedAgent}/merge-pr/SKILL.md`,
            subClass: "agent-homes",
            agent: recordedAgent,
            sha256: sha256Bytes(recordedMd),
            sourceMtimeMs: 1_784_000_000_000,
            size: recordedMd.length
          }
        ]
      },
      null,
      2
    )
  );
  return { root, base };
}

function hydrate(options: {
  stationId: string;
  repoRoot: string;
  dryRun?: boolean;
  cacheRoot?: string;
}): StationHydrationResult {
  return writeStationHydration({
    stationId: options.stationId,
    repoRoot: options.repoRoot,
    cacheRoot: options.cacheRoot,
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {})
  });
}

describe("station hydration (port of fleet-resources hydrate-cache.mjs v1)", () => {
  test("content beats the manifest-hash-matched stub (P-01641 regression)", () => {
    const stationId = "station-test";
    const { root } = buildSnapshot(stationId, CONTENT_MD, STUB_MD, { manifestRecords: "codewith" });
    const cache = tempCache();
    try {
      const result = hydrate({ stationId, repoRoot: root, dryRun: false, cacheRoot: cache.skills });
      const dest = join(cache.skills, "merge-pr", "SKILL.md");
      const written = readFileSync(dest, "utf8");
      expect(written).toBe(CONTENT_MD);
      expect(/^kind:\s*executable\b/m.test(written)).toBe(false);
      expect(result.stats.written).toBe(1);

      // The hydration manifest records the content winner's own bytes.
      const manifestPath = join(cache.base, `hydration-${stationId}.json`);
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.schema).toBe(STATION_HYDRATION_MANIFEST_SCHEMA);
      expect(manifest.producer.name).toBe("@hasna/skills");
      expect(manifest.skills.length).toBe(1);
      expect(manifest.skills[0].ident).toBe("merge-pr");
      expect(manifest.skills[0].files[0].sourceAgent).toBe("claude");
      expect(manifest.skills[0].sha256).toBe(sha256File(dest));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });

  test("stub-only candidates still hydrate a stub (the filter must not produce an empty winner)", () => {
    const stationId = "station-stubonly";
    const { root } = buildSnapshot(stationId, STUB_MD, STUB_MD);
    const cache = tempCache();
    try {
      hydrate({ stationId, repoRoot: root, dryRun: false, cacheRoot: cache.skills });
      const written = readFileSync(join(cache.skills, "merge-pr", "SKILL.md"), "utf8");
      expect(written).toBe(STUB_MD);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });

  test("dry-run is the default and writes nothing", () => {
    const stationId = "station-test";
    const { root } = buildSnapshot(stationId, CONTENT_MD, STUB_MD);
    const cache = tempCache();
    try {
      const result = hydrate({ stationId, repoRoot: root, cacheRoot: cache.skills });
      expect(result.mode).toBe("dry-run");
      expect(result.stats.idents).toBe(1);
      expect(result.stats.files).toBe(1);
      expect(existsSync(join(cache.skills, "merge-pr"))).toBe(false);
      expect(existsSync(join(cache.base, `hydration-${stationId}.json`))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });

  test("a missing sync-manifest is terminal non-acceptance", () => {
    const repoRoot = tempDir("hydrate-empty-repo-");
    const cache = tempCache();
    try {
      let thrown: StationSnapshotError | null = null;
      try {
        hydrate({ stationId: "station-test", repoRoot, dryRun: false, cacheRoot: cache.skills });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("MANIFEST_UNREADABLE");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });

  test("symlinks inside the snapshot are refused (fail closed)", () => {
    const stationId = "station-test";
    const { root } = buildSnapshot(stationId, CONTENT_MD, STUB_MD, {
      extra: { "claude/merge-pr/scripts/run.sh": "#!/usr/bin/env bash\n" }
    });
    symlinkSync(
      join(root, "resources", stationId, "skills", "agent-homes", "claude", "merge-pr", "scripts", "run.sh"),
      join(root, "resources", stationId, "skills", "agent-homes", "claude", "merge-pr", "scripts", "link.sh")
    );
    const cache = tempCache();
    try {
      let thrown: StationSnapshotError | null = null;
      try {
        hydrate({ stationId, repoRoot: root, dryRun: false, cacheRoot: cache.skills });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("SYMLINKS_REFUSED");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });

  test("an existing cache file with different content is terminal non-acceptance, and nothing is written", () => {
    const stationId = "station-test";
    const { root } = buildSnapshot(stationId, CONTENT_MD, STUB_MD, {
      extra: { "claude/merge-pr/scripts/run.sh": "#!/usr/bin/env bash\n" }
    });
    const cache = tempCache();
    try {
      // Pre-poison the SKILL.md destination with different content.
      mkdirSync(join(cache.skills, "merge-pr"), { recursive: true });
      writeFileSync(join(cache.skills, "merge-pr", "SKILL.md"), "different content\n");

      let thrown: StationSnapshotError | null = null;
      try {
        hydrate({ stationId, repoRoot: root, dryRun: false, cacheRoot: cache.skills });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("CONFLICT");
      expect(thrown?.detail[0]).toContain("merge-pr/SKILL.md");
      // Conflict detected before any write: scripts/run.sh is absent.
      expect(existsSync(join(cache.skills, "merge-pr", "scripts", "run.sh"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });

  test("an invalid station id is refused before any manifest read", () => {
    const repoRoot = tempDir("hydrate-empty-repo-");
    const cache = tempCache();
    try {
      let thrown: StationSnapshotError | null = null;
      try {
        hydrate({ stationId: "Station Two!", repoRoot, cacheRoot: cache.skills });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("INVALID_STATION");
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(cache.base, { recursive: true, force: true });
    }
  });
});
