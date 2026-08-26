import { describe, expect, test } from "bun:test";
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
  STATION_SYNC_MANIFEST_SCHEMA,
  StationSnapshotError,
  sha256File,
  writeStationSnapshot,
  type StationSnapshotResult
} from "./station-snapshot.js";

useDefaultTestTimeout();

const CONTENT_MD =
  "---\nname: demo-skill\ndescription: Demo\n---\n\n# Demo\n\nFull content.\n";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Write a file at <homes>/<homeRelative> with parent dirs. */
function seedHome(homes: string, homeRelative: string, content: string): void {
  const target = join(homes, homeRelative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function buildHomes(): string {
  const homes = tempDir("snapshot-homes-");
  // skills store (~/.hasna/skills/skills): one portable skill with two files.
  seedHome(homes, ".hasna/skills/skills/demo-skill/SKILL.md", CONTENT_MD);
  seedHome(homes, ".hasna/skills/skills/demo-skill/skill.json", "{\"name\":\"demo-skill\"}\n");
  // non-portable + excluded content that must never reach the snapshot.
  seedHome(homes, ".hasna/skills/skills/demo-skill/.env", "SECRET=1\n");
  seedHome(homes, ".hasna/skills/skills/demo-skill/node_modules/pkg/index.js", "// drop\n");
  seedHome(homes, ".hasna/skills/skills/demo-skill/README.md", "// not portable\n");
  // custom store (~/.hasna/skills/custom).
  seedHome(homes, ".hasna/skills/custom/priv-skill/SKILL.md", CONTENT_MD);
  // an agent home (~/.claude/skills) with a portable subdir file.
  seedHome(homes, ".claude/skills/claude-skill/SKILL.md", CONTENT_MD);
  seedHome(homes, ".claude/skills/claude-skill/scripts/run.sh", "#!/usr/bin/env bash\n");
  return homes;
}

function snapshot(options: {
  stationId: string;
  homes: string;
  repoRoot: string;
  dryRun?: boolean;
}): StationSnapshotResult {
  return writeStationSnapshot({
    stationId: options.stationId,
    homesRoot: options.homes,
    repoRoot: options.repoRoot,
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {})
  });
}

describe("station snapshot (port of fleet-resources sync-skills.mjs v3)", () => {
  test("dry-run is the default and writes nothing", () => {
    const homes = buildHomes();
    const repo = tempDir("snapshot-repo-");
    try {
      const result = snapshot({ stationId: "station-test", homes, repoRoot: repo });
      expect(result.mode).toBe("dry-run");
      // 2 (skills) + 1 (custom) + 2 (claude home) portable files.
      expect(result.stats.files).toBe(5);
      expect(result.stats.bytes).toBeGreaterThan(0);
      expect(existsSync(join(repo, "resources"))).toBe(false);
      expect(result.files.length).toBe(5);
      // The agent-home destination shape is preserved.
      const claudeRun = result.files.find(
        (file) => file.destination === "resources/station-test/skills/agent-homes/claude/claude-skill/scripts/run.sh"
      );
      expect(claudeRun).toBeDefined();
      expect(claudeRun?.agent).toBe("claude");
      expect(claudeRun?.subClass).toBe("agent-homes");
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("populate writes the snapshot layout and the v3 sync-manifest", () => {
    const homes = buildHomes();
    const repo = tempDir("snapshot-repo-");
    try {
      const result = snapshot({ stationId: "station-test", homes, repoRoot: repo, dryRun: false });
      expect(result.mode).toBe("populate");
      expect(result.stats.written).toBe(5);
      expect(result.stats.unchanged).toBe(0);

      const manifestPath = join(repo, "resources", "station-test", "skills", "sync-manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.schema).toBe(STATION_SYNC_MANIFEST_SCHEMA);
      expect(manifest.stationId).toBe("station-test");
      expect(manifest.producer.name).toBe("@hasna/skills");
      expect(typeof manifest.producer.version).toBe("string");
      expect(manifest.stats.written).toBe(5);
      expect(manifest.files.length).toBe(5);

      // The destination bytes are the source bytes, and the manifest hash is
      // the plain sha256 of those bytes (the hydrator's wire contract).
      const dest = join(repo, "resources", "station-test", "skills", "skills", "demo-skill", "SKILL.md");
      expect(readFileSync(dest, "utf8")).toBe(CONTENT_MD);
      const entry = manifest.files.find(
        (file: { destination: string }) => file.destination === "resources/station-test/skills/skills/demo-skill/SKILL.md"
      );
      expect(entry.sha256).toBe(sha256File(dest));
      expect(entry.agent).toBeNull();
      // Excluded and non-portable content never reached the snapshot.
      expect(existsSync(join(repo, "resources", "station-test", "skills", "skills", "demo-skill", ".env"))).toBe(false);
      expect(existsSync(join(repo, "resources", "station-test", "skills", "skills", "demo-skill", "README.md"))).toBe(false);

      // Idempotent re-populate: everything unchanged, nothing written.
      const again = snapshot({ stationId: "station-test", homes, repoRoot: repo, dryRun: false });
      expect(again.stats.written).toBe(0);
      expect(again.stats.unchanged).toBe(5);
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("an existing destination with different content is terminal non-acceptance, and nothing is written", () => {
    const homes = buildHomes();
    const repo = tempDir("snapshot-repo-");
    try {
      snapshot({ stationId: "station-test", homes, repoRoot: repo, dryRun: false });
      // Poison one destination with different content.
      const poisoned = join(repo, "resources", "station-test", "skills", "skills", "demo-skill", "SKILL.md");
      writeFileSync(poisoned, "different content\n");
      // A new portable file that a partial writer would have written.
      seedHome(homes, ".hasna/skills/custom/priv-skill/scripts/new.sh", "#!/usr/bin/env bash\n");

      let thrown: StationSnapshotError | null = null;
      try {
        snapshot({ stationId: "station-test", homes, repoRoot: repo, dryRun: false });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("CONFLICT");
      expect(thrown?.message).toContain("terminal non-acceptance");
      expect(thrown?.detail.length).toBe(1);
      expect(thrown?.detail[0]).toContain("demo-skill/SKILL.md");
      // The conflict was detected before any write: the new file is absent.
      expect(existsSync(join(repo, "resources", "station-test", "skills", "custom", "priv-skill", "scripts", "new.sh"))).toBe(false);
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("symlinks inside skill homes are refused (fail closed)", () => {
    const homes = buildHomes();
    const repo = tempDir("snapshot-repo-");
    try {
      symlinkSync(
        join(homes, ".hasna", "skills", "skills", "demo-skill", "SKILL.md"),
        join(homes, ".hasna", "skills", "skills", "demo-skill", "link.md")
      );
      let thrown: StationSnapshotError | null = null;
      try {
        snapshot({ stationId: "station-test", homes, repoRoot: repo });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("SYMLINKS_REFUSED");
      expect(thrown?.message).toContain("fail closed");
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("an invalid station id is refused before any scan", () => {
    const homes = buildHomes();
    const repo = tempDir("snapshot-repo-");
    try {
      let thrown: StationSnapshotError | null = null;
      try {
        snapshot({ stationId: "Station Two!", homes, repoRoot: repo });
      } catch (error) {
        thrown = error as StationSnapshotError;
      }
      expect(thrown).not.toBeNull();
      expect(thrown?.code).toBe("INVALID_STATION");
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
