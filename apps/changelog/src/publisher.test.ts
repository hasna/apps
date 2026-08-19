import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publishChangelog } from "./publisher.js";
import type { ChangelogEntry, ChangelogStore } from "./types.js";

function makeEntry(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  const base: ChangelogEntry = {
    id: "00000000-0000-4000-8000-000000000001",
    appId: "app",
    version: "1.0.0",
    kind: "added",
    category: "added",
    title: "Generated entry",
    date: "2026-07-01",
    tags: [],
    links: [],
    commits: [],
    tasks: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    source: "server",
    fingerprint: "fp",
  };
  return { ...base, ...overrides };
}

/** A store whose listEntries fails loudly — proves publishChangelog never consults it when `entries` are provided. */
function failingStore(): ChangelogStore {
  return {
    listEntries: async () => {
      throw new Error("store must not be consulted when entries are provided");
    },
  } as unknown as ChangelogStore;
}

describe("publishChangelog", () => {
  test("reports changed=false and writes no backup when the target already matches", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-unchanged-"));
    const first = await publishChangelog({ entries: [makeEntry()], cwd, write: true });
    expect(first.changed).toBe(true);

    const second = await publishChangelog({ entries: [makeEntry()], cwd, write: true });
    expect(second.changed).toBe(false);
    expect(second.mode).toBe("write");
    expect(second.backupPath).toBeUndefined();
    expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toBe(first.markdown);
  });

  test("writes no backup when the target did not previously exist", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-fresh-"));
    const result = await publishChangelog({ entries: [makeEntry()], cwd, write: true });
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeUndefined();
  });

  test("honors backup:false and never creates a backup file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-nobackup-"));
    const dataDir = await mkdtemp(join(tmpdir(), "changelog-pub-nobackup-data-"));
    const previous = process.env["CHANGELOG_DATA_DIR"];
    process.env["CHANGELOG_DATA_DIR"] = dataDir;
    try {
      await writeFile(join(cwd, "CHANGELOG.md"), "# Old\n", "utf8");
      const result = await publishChangelog({ entries: [makeEntry()], cwd, write: true, backup: false });
      expect(result.changed).toBe(true);
      expect(result.backupPath).toBeUndefined();
      expect(existsSync(join(dataDir, "backups"))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env["CHANGELOG_DATA_DIR"];
      else process.env["CHANGELOG_DATA_DIR"] = previous;
    }
  });

  test("writes backups into CHANGELOG_DATA_DIR with a sanitized basename and timestamp", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-backup-"));
    const dataDir = await mkdtemp(join(tmpdir(), "changelog-pub-backup-data-"));
    const previous = process.env["CHANGELOG_DATA_DIR"];
    process.env["CHANGELOG_DATA_DIR"] = dataDir;
    try {
      await writeFile(join(cwd, "my file!.md"), "# Old\n", "utf8");
      const result = await publishChangelog({
        entries: [makeEntry()],
        cwd,
        targetPath: "my file!.md",
        write: true,
      });
      expect(result.backupPath).toBeString();
      expect(result.backupPath!.startsWith(join(dataDir, "backups"))).toBe(true);
      // Unsafe characters are replaced with underscores; the timestamp suffix is present.
      expect(result.backupPath!.split("/").at(-1)).toMatch(/^my_file_\.md\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.bak$/);
      expect(await readFile(result.backupPath!, "utf8")).toBe("# Old\n");
    } finally {
      if (previous === undefined) delete process.env["CHANGELOG_DATA_DIR"];
      else process.env["CHANGELOG_DATA_DIR"] = previous;
    }
  });

  test("returns an empty-string diff when content is unchanged", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-diffidem-"));
    await publishChangelog({ entries: [makeEntry()], cwd, write: true });
    const second = await publishChangelog({ entries: [makeEntry()], cwd, write: true, diff: true });
    expect(second.diff).toBe("");
  });

  test("diff marks removed and added lines and skips identical ones at the same index", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-diff-"));
    // "All notable changes..." sits at the same index in both files and must not be prefixed.
    await writeFile(join(cwd, "CHANGELOG.md"), "# Old\n\nAll notable changes are documented in this file.\n", "utf8");
    const result = await publishChangelog({ entries: [], cwd, diff: true });
    expect(result.diff).toContain("-# Old");
    expect(result.diff).toContain("+# Changelog");
    // The line identical at the same index is omitted entirely — never prefixed.
    expect(result.diff).not.toContain("All notable changes are documented in this file.");
    // The generated file is longer: each extra tail line is +-marked.
    const minusLines = result.diff!.split("\n").filter((line) => line.startsWith("-") && line !== "--- current");
    const plusLines = result.diff!.split("\n").filter((line) => line.startsWith("+") && line !== "+++ generated");
    expect(minusLines).toEqual(["-# Old"]);
    expect(plusLines.length).toBeGreaterThan(1);
  });

  test("bytes counts UTF-8 bytes, not characters", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-bytes-"));
    const result = await publishChangelog({
      entries: [makeEntry({ title: "Café — 2-byte chars" })],
      cwd,
    });
    // "é" (U+00E9) is 2 UTF-8 bytes and "—" (U+2014) is 3 bytes.
    expect(result.markdown).toContain("Café");
    expect(result.bytes).toBe(Buffer.byteLength(result.markdown, "utf8"));
    expect(result.bytes).toBeGreaterThan(result.markdown.length);
  });

  test("resolves relative targetPath under cwd and keeps absolute paths as-is", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-target-"));
    const relative = await publishChangelog({ entries: [makeEntry()], cwd, targetPath: "docs/changelog.md", write: true });
    expect(relative.targetPath).toBe(join(cwd, "docs", "changelog.md"));
    expect(await readFile(relative.targetPath, "utf8")).toContain("Generated entry");

    const absolute = await publishChangelog({ entries: [makeEntry()], cwd, targetPath: join(cwd, "abs.md"), write: true });
    expect(absolute.targetPath).toBe(join(cwd, "abs.md"));
    expect(await readFile(join(cwd, "abs.md"), "utf8")).toContain("Generated entry");
  });

  test("uses provided entries and never consults the store", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-entries-"));
    const result = await publishChangelog({ entries: [makeEntry()], store: failingStore(), cwd, write: true });
    expect(result.markdown).toContain("Generated entry");
    expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toContain("Generated entry");
  });

  test("passes the list filter through to the store with a 500-entry default limit", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-filter-"));
    let received: unknown;
    const spyStore = {
      listEntries: async (filter: unknown) => {
        received = filter;
        return [makeEntry({ tags: ["release"] })];
      },
    } as unknown as ChangelogStore;
    const result = await publishChangelog({
      store: spyStore,
      appId: "app",
      version: "1.0.0",
      kind: "added",
      tag: "Release",
      cwd,
    });
    expect(received).toEqual({
      appId: "app",
      version: "1.0.0",
      kind: "added",
      category: undefined,
      tag: "Release",
      limit: 500,
    });
    expect(result.markdown).toContain("Generated entry");
  });
});

test("does not rewrite the target file when the render is unchanged (mtime preserved)", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-mtime-"));
  await publishChangelog({ entries: [makeEntry()], cwd, write: true });
  const target = join(cwd, "CHANGELOG.md");
  const before = await stat(target);
  const second = await publishChangelog({ entries: [makeEntry()], cwd, write: true });
  const after = await stat(target);
  expect(second.changed).toBe(false);
  expect(after.mtimeMs).toBe(before.mtimeMs);
  expect(after.size).toBe(before.size);
});

test("empty entries still produce a full document and report changed against a different file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-empty-"));
  await writeFile(join(cwd, "CHANGELOG.md"), "# Old\n", "utf8");
  const result = await publishChangelog({ entries: [], cwd, write: true });
  expect(result.changed).toBe(true);
  expect(result.markdown).toContain("# Changelog");
  // Two-sided: the empty-entry document carries the no-entries marker and
  // must NOT contain any entry body, so an existence-only check cannot pass.
  expect(result.markdown).toContain("No changes recorded yet.");
  expect(result.markdown).not.toContain("Generated entry");
});

test("multiple entries are all rendered in the generated document", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "changelog-pub-multi-"));
  const entries = [
    makeEntry({ id: "00000000-0000-4000-8000-000000000001", title: "First entry" }),
    makeEntry({ id: "00000000-0000-4000-8000-000000000002", title: "Second entry" }),
  ];
  const single = await publishChangelog({ entries: [makeEntry({ title: "Lone entry" })], cwd, write: true });
  const multi = await publishChangelog({ entries, cwd, write: true });
  expect(multi.markdown).toContain("First entry");
  expect(multi.markdown).toContain("Second entry");
  expect(multi.changed).toBe(true);
  // The multi-entry document differs from the single-entry document, so a test that
  // only checked "some title exists" could not stand in for this assertion.
  expect(multi.markdown).not.toBe(single.markdown);
});
