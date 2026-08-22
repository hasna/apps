// Regression cover for todos 14f2ddd3: applying a config whose on-disk content
// is byte-identical to the stored content MUST NOT bump the config version or
// mint a snapshot row. applyPreparedConfig called store.updateConfig({synced_at})
// unconditionally on every non-dry-run apply, and updateConfig always executes
// "version = version + 1" plus a full-content snapshot insert inside its
// transaction — so every unchanged apply grew the snapshot table by one row per
// config per run forever, with no reachable prune path on the local SQLite store
// (pruneSnapshots existed on the store interface but its only caller was the
// server endpoint POST /v1/configs/:id/snapshots/prune).
//
// Live repro (isolated temp DB, 2026-08-22): `instructions add` -> version 1,
// snapshot v1; two identical `instructions apply` runs each printed
// "= <path> (unchanged)" yet version climbed to 3 and snapshot list showed
// v3/v2/v1; the dry-run negative control kept version 3 and 3 rows.
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { makeTempRoot } from "../lib/test-temp-root";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bun", ["src/cli/index.tsx", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HASNA_INSTRUCTIONS_API_URL: undefined,
      HASNA_INSTRUCTIONS_API_KEY: undefined,
      ...env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
  });
}

function isolatedEnv(root: string) {
  return { HASNA_INSTRUCTIONS_DB_PATH: join(root, "db.sqlite"), CONFIGS_HOME: root };
}

function rowsNamed(root: string, name: string): Array<{ slug: string; version: number }> {
  const listed = runCli(["list", "--json"], isolatedEnv(root));
  expect(listed.status).toBe(0);
  const all = JSON.parse(listed.stdout) as Array<{ slug: string; name: string; version: number }>;
  return all.filter((c) => c.name === name).map(({ slug, version }) => ({ slug, version }));
}

function snapshotVersions(root: string, slug: string): string[] {
  const listed = runCli(["snapshot", "list", slug], isolatedEnv(root));
  expect(listed.status).toBe(0);
  return listed.stdout
    .split("\n")
    .filter((line) => /^\s*v\d+\s/.test(line))
    .map((line) => line.trim().split(/\s+/)[0]!);
}

describe("apply of a byte-identical config — no version bump, no snapshot growth", () => {
  test("two unchanged applies keep version 1 and a single v1 snapshot", () => {
    const root = makeTempRoot("configs-apply-unchanged-");
    const source = join(root, "rule.md");
    writeFileSync(source, "hello repro config\n");
    expect(runCli(["add", source, "--name", "rule.md"], isolatedEnv(root)).status).toBe(0);

    const slug = rowsNamed(root, "rule.md")[0]!.slug;

    const first = runCli(["apply", slug], isolatedEnv(root));
    expect(first.status).toBe(0);
    expect(`${first.stdout}${first.stderr}`).toContain("(unchanged)");

    const second = runCli(["apply", slug], isolatedEnv(root));
    expect(second.status).toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain("(unchanged)");

    const rows = rowsNamed(root, "rule.md");
    expect(rows.length).toBe(1);
    // Before the fix this climbed to 3: every non-dry-run apply ran
    // updateConfig({synced_at}), which does "version = version + 1" and mints a
    // snapshot row even though nothing on disk changed.
    expect(rows[0]!.version).toBe(1);
    expect(snapshotVersions(root, slug)).toEqual(["v1"]);
  });

  test("apply --dry-run never bumps version or snapshots even when the file changed on disk", () => {
    const root = makeTempRoot("configs-apply-dryrun-");
    const source = join(root, "rule.md");
    writeFileSync(source, "v1\n");
    expect(runCli(["add", source, "--name", "rule.md"], isolatedEnv(root)).status).toBe(0);

    const slug = rowsNamed(root, "rule.md")[0]!.slug;
    writeFileSync(source, "v2 changed on disk\n");
    const dry = runCli(["apply", slug, "--dry-run"], isolatedEnv(root));
    expect(dry.status).toBe(0);

    const rows = rowsNamed(root, "rule.md");
    expect(rows[0]!.version).toBe(1);
    expect(snapshotVersions(root, slug)).toEqual(["v1"]);
  });
});

describe("snapshot prune — the local store's reclaim path", () => {
  test("prune --keep N deletes older snapshots and keeps the N most recent", () => {
    const root = makeTempRoot("configs-snapshot-prune-");
    const source = join(root, "rule.md");
    writeFileSync(source, "v1 content\n");
    expect(runCli(["add", source, "--name", "rule.md"], isolatedEnv(root)).status).toBe(0);
    const slug = rowsNamed(root, "rule.md")[0]!.slug;

    // Seed four distinct versions directly at the DB layer (add --update mints
    // an extra provenance snapshot at the pre-update version, which would
    // duplicate version numbers and make a version-list assertion ambiguous).
    const seed = spawnSync(
      "bun",
      [
        "-e",
        `
        import { getConfig } from "./src/db/configs.ts";
        import { createSnapshot } from "./src/db/snapshots.ts";
        const id = getConfig("${slug}").id;
        createSnapshot(id, "v2 content\\n", 2);
        createSnapshot(id, "v3 content\\n", 3);
        createSnapshot(id, "v4 content\\n", 4);
        `,
      ],
      { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...isolatedEnv(root), HASNA_INSTRUCTIONS_API_URL: undefined, HASNA_INSTRUCTIONS_API_KEY: undefined } },
    );
    expect(seed.status).toBe(0);
    expect(snapshotVersions(root, slug)).toEqual(["v4", "v3", "v2", "v1"]);

    const pruned = runCli(["snapshot", "prune", slug, "--keep", "2"], isolatedEnv(root));
    expect(pruned.status).toBe(0);
    // Before the fix this command did not exist at all (unknown command, rc=1).
    expect(`${pruned.stdout}${pruned.stderr}`).toContain("2");

    expect(snapshotVersions(root, slug)).toEqual(["v4", "v3"]);
  });
});
