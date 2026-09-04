import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCliInCwd } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * CLI surface of the package-owned generalization of
 * fleet-resources scripts/sync-skills.mjs and scripts/hydrate-cache.mjs
 * (todos FLE-00037): `skills sync --station <id> [--populate]` snapshots the
 * installed skill homes into resources/<station>/skills, and
 * `skills hydrate --station <id> [--apply]` hydrates the dedup corpus cache
 * from that snapshot. Fail-closed classes exit 2.
 */

const CONTENT_MD =
  "---\nname: merge-pr\ndescription: Merge a pull request\n---\n\n# Merge PR\n\nFull content that must survive hydration, in full.\n";

const STUB_MD =
  "---\nname: merge-pr\ndescription: Merge a pull request\nkind: executable\n---\n\n# Merge PR\n\nThis is an executable skill from the @hasna/skills catalog. It is not run from this\nfile: invoke it with `skills run merge-pr` or through the Skills API. The runnable\nsource lives in the catalog, not in this agent folder.\n";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function seedHome(homes: string, homeRelative: string, content: string): void {
  const target = join(homes, homeRelative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

function buildHomes(): string {
  const homes = tempDir("cli-snapshot-homes-");
  seedHome(homes, join(".hasna", "skills", "skills", "demo-skill", "SKILL.md"), CONTENT_MD);
  return homes;
}

/**
 * Snapshot repo with a poisoned history: claude holds content, codewith holds
 * a pointer stub, and the sync-manifest records the STUB hash (the P-01641
 * poisoning shape) so the hydrate must still prefer content.
 */
function buildSnapshotRepo(stationId: string): string {
  const repo = tempDir("cli-hydrate-snapshot-");
  const base = join(repo, "resources", stationId, "skills");
  mkdirSync(join(base, "agent-homes", "claude", "merge-pr"), { recursive: true });
  mkdirSync(join(base, "agent-homes", "codewith", "merge-pr"), { recursive: true });
  writeFileSync(join(base, "agent-homes", "claude", "merge-pr", "SKILL.md"), CONTENT_MD);
  writeFileSync(join(base, "agent-homes", "codewith", "merge-pr", "SKILL.md"), STUB_MD);
  writeFileSync(
    join(base, "sync-manifest.json"),
    JSON.stringify({
      schema: "hasna.fleet-resources.skills-sync-manifest/v1",
      stationId,
      syncedAt: "2026-08-22T00:00:00.000Z",
      producer: "cli.test",
      stats: {},
      files: [
        {
          relativePath: "merge-pr/SKILL.md",
          destination: `resources/${stationId}/skills/agent-homes/codewith/merge-pr/SKILL.md`,
          subClass: "agent-homes",
          agent: "codewith",
          sha256: createHash("sha256").update(STUB_MD).digest("hex"),
          sourceMtimeMs: 1_784_000_000_000,
          size: STUB_MD.length
        }
      ]
    }, null, 2)
  );
  return repo;
}

describe("CLI station snapshot and hydration (FLE-00037)", () => {
  test("`skills sync --station` defaults to dry-run and writes nothing", async () => {
    const homes = buildHomes();
    const repo = tempDir("cli-snapshot-repo-");
    const cwd = tempDir("cli-cwd-");
    try {
      const { stdout, stderr, exitCode } = await runCliInCwd([
        "sync", "--station", "cli-station", "--homes-root", homes, "--repo-root", repo
      ], cwd);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("DRY-RUN station=cli-station");
      expect(existsSync(join(repo, "resources"))).toBe(false);
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("`skills sync --station --populate` writes the snapshot and its sync-manifest", async () => {
    const homes = buildHomes();
    const repo = tempDir("cli-snapshot-repo-");
    const cwd = tempDir("cli-cwd-");
    try {
      const { stdout, stderr, exitCode } = await runCliInCwd([
        "sync", "--station", "cli-station", "--homes-root", homes, "--repo-root", repo, "--populate"
      ], cwd);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("POPULATE station=cli-station written=1");
      const manifestPath = join(repo, "resources", "cli-station", "skills", "sync-manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.schema).toBe("hasna.fleet-resources.skills-sync-manifest/v1");
      expect(manifest.producer.name).toBe("@hasna/skills");
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("`skills sync --station --populate` exits 2 on a conflicting destination", async () => {
    const homes = buildHomes();
    const repo = tempDir("cli-snapshot-repo-");
    const cwd = tempDir("cli-cwd-");
    try {
      await runCliInCwd([
        "sync", "--station", "cli-station", "--homes-root", homes, "--repo-root", repo, "--populate"
      ], cwd);
      const dest = join(repo, "resources", "cli-station", "skills", "skills", "demo-skill", "SKILL.md");
      writeFileSync(dest, "different content\n");

      const { stdout, stderr, exitCode } = await runCliInCwd([
        "sync", "--station", "cli-station", "--homes-root", homes, "--repo-root", repo, "--populate"
      ], cwd);
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toContain("CONFLICT");
      expect(stderr).toContain("terminal non-acceptance");
    } finally {
      rmSync(homes, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("`skills hydrate --station --apply` prefers content over the manifest-hash-matched stub", async () => {
    const repo = buildSnapshotRepo("cli-hydrate-station");
    const cacheBase = tempDir("cli-hydrate-cache-");
    const cache = join(cacheBase, "skills");
    const cwd = tempDir("cli-cwd-");
    try {
      const { stdout, stderr, exitCode } = await runCliInCwd([
        "hydrate", "--station", "cli-hydrate-station", "--repo-root", repo, "--cache-root", cache, "--apply"
      ], cwd);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("HYDRATE station=cli-hydrate-station idents=1 written=1 unchanged=0");
      const dest = join(cache, "merge-pr", "SKILL.md");
      expect(readFileSync(dest, "utf8")).toBe(CONTENT_MD);
      expect(existsSync(join(cacheBase, "hydration-cli-hydrate-station.json"))).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(cacheBase, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("`skills hydrate` without --station is rejected", async () => {
    const cwd = tempDir("cli-cwd-");
    try {
      const { exitCode } = await runCliInCwd(["hydrate"], cwd);
      expect(exitCode).not.toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("`skills hydrate --station` exits 2 when the snapshot manifest is missing", async () => {
    const repo = tempDir("cli-hydrate-empty-");
    const cacheBase = tempDir("cli-hydrate-cache-");
    const cwd = tempDir("cli-cwd-");
    try {
      const { stdout, stderr, exitCode } = await runCliInCwd([
        "hydrate", "--station", "cli-hydrate-station", "--repo-root", repo, "--cache-root", join(cacheBase, "skills")
      ], cwd);
      expect(exitCode).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toContain("cannot read snapshot manifest");
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(cacheBase, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
