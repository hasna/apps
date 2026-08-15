import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipStore, purgeClipStore } from "./storage.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clip-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ClipStore", () => {
  it("creates text shares with stable share urls", () => {
    const store = new ClipStore({ homeDir: dir, baseUrl: "http://lan.test:3741" });
    try {
      const record = store.createTextClip({ text: "hello", title: "Hello" });
      expect(record.kind).toBe("text");
      expect(record.text).toBe("hello");
      expect(record.shareUrl).toBe(`http://lan.test:3741/s/${record.slug}`);
      expect(store.getClip(record.id)?.id).toBe(record.id);
      expect(store.listClips({ limit: 10 })).toHaveLength(1);
      expect(() => store.createTextClip({ text: "bad expiry", expiresAt: "not-a-date" })).toThrow("valid date");
      expect(() => store.createBufferClip({
        buffer: new TextEncoder().encode("bad expiry"),
        kind: "file",
        mimeType: "text/plain",
        expiresAt: "not-a-date",
      })).toThrow("valid date");
      expect(readdirSync(store.artifactDir)).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it("imports file artifacts and soft deletes records", () => {
    const file = join(dir, "sample.txt");
    writeFileSync(file, "artifact");
    const store = new ClipStore({ homeDir: dir });
    try {
      const record = store.createFileClip({ path: file });
      expect(record.kind).toBe("file");
      expect(record.artifactPath).toContain("artifacts");
      expect(record.sizeBytes).toBe(8);
      expect(store.deleteClip(record.slug)).toBe(true);
      expect(store.getClip(record.id)).toBeNull();
      expect(store.getClip(record.id, { includeDeleted: true })?.deletedAt).toBeTruthy();
    } finally {
      store.close();
    }
  });

  it("stores bounded clipboard history and prunes oldest entries", () => {
    const store = new ClipStore({ homeDir: dir });
    try {
      const first = store.addClipboardHistory({
        kind: "clipboard-text",
        text: "one",
        title: "One",
        source: "clipboard:text",
        metadata: { test: true },
        maxItems: 3,
      });
      const second = store.addClipboardHistory({
        kind: "clipboard-text",
        text: "two",
        title: "Two",
        source: "clipboard:text",
        maxItems: 3,
      });
      const third = store.addClipboardHistory({
        kind: "clipboard-text",
        text: "three",
        title: "Three",
        source: "clipboard:text",
        maxItems: 2,
      });

      const entries = store.listClipboardHistory({ limit: 10 });
      expect(entries.map((entry) => entry.text)).toEqual(["three", "two"]);
      expect(entries.map((entry) => entry.id)).toEqual([third.id, second.id]);
      expect(store.getClipboardHistory(first.id)).toBeNull();
      expect(store.getClipboardHistory(second.slug)?.text).toBe("two");
    } finally {
      store.close();
    }
  });

  it("re-shares clipboard history as a normal share", () => {
    const store = new ClipStore({ homeDir: dir, baseUrl: "http://clip.test" });
    try {
      const entry = store.addClipboardHistory({
        kind: "clipboard-text",
        text: "saved clipboard",
        source: "clipboard:text",
        maxItems: 5,
      });

      const record = store.shareClipboardHistory(entry.id, { title: "Shared again", baseUrl: "http://clip.test" });

      expect(record.kind).toBe("text");
      expect(record.text).toBe("saved clipboard");
      expect(record.title).toBe("Shared again");
      expect(record.metadata.clipboardHistoryId).toBe(entry.id);
      expect(record.shareUrl).toStartWith("http://clip.test/s/");
      expect(store.listClips({ limit: 10 })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("stores clipboard history with private local filesystem modes", () => {
    const store = new ClipStore({ homeDir: dir });
    try {
      const entry = store.addClipboardHistory({
        kind: "clipboard-image",
        buffer: new TextEncoder().encode("private bytes"),
        mimeType: "image/png",
        source: "clipboard:test",
        extension: ".png",
        maxItems: 5,
      });

      expect(statSync(store.homeDir).mode & 0o777).toBe(0o700);
      expect(statSync(store.artifactDir).mode & 0o777).toBe(0o700);
      expect(statSync(store.dbPath).mode & 0o777).toBe(0o600);
      expect(entry.artifactPath).toBeTruthy();
      expect(statSync(entry.artifactPath!).mode & 0o777).toBe(0o600);
    } finally {
      store.close();
    }
  });

  it("removes pruned binary history artifacts before deleting rows", () => {
    const store = new ClipStore({ homeDir: dir });
    try {
      const first = store.addClipboardHistory({
        kind: "clipboard-image",
        buffer: new TextEncoder().encode("old image"),
        mimeType: "image/png",
        source: "clipboard:test",
        extension: ".png",
        maxItems: 2,
      });
      expect(first.artifactPath).toBeTruthy();
      expect(existsSync(first.artifactPath!)).toBe(true);

      const second = store.addClipboardHistory({
        kind: "clipboard-image",
        buffer: new TextEncoder().encode("new image"),
        mimeType: "image/png",
        source: "clipboard:test",
        extension: ".png",
        maxItems: 1,
      });

      expect(existsSync(first.artifactPath!)).toBe(false);
      expect(store.getClipboardHistory(first.id)).toBeNull();
      expect(store.listClipboardHistory({ limit: 10 }).map((entry) => entry.id)).toEqual([second.id]);
    } finally {
      store.close();
    }
  });

  it("purges the resolved clip home without touching files outside it", () => {
    const home = join(dir, "clip-home");
    const outside = join(dir, "outside.txt");
    mkdirSync(home, { recursive: true });
    writeFileSync(outside, "keep");
    writeFileSync(join(home, "config.json"), "{}\n");

    const store = new ClipStore({ homeDir: home });
    try {
      const record = store.createBufferClip({
        buffer: new TextEncoder().encode("artifact"),
        kind: "file",
        mimeType: "text/plain",
      });
      expect(existsSync(record.artifactPath ?? "")).toBe(true);
    } finally {
      store.close();
    }

    const result = purgeClipStore({ homeDir: home, confirm: true });

    expect(result.removed).toBe(true);
    expect(result.homeRemoved).toBe(true);
    expect(result.homeDir).toBe(home);
    expect(result.configPath).toBe(join(home, "config.json"));
    expect(existsSync(home)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("does not recursively remove unrelated files inside a configured home", () => {
    const home = join(dir, "shared-home");
    const unrelated = join(home, "notes.txt");
    mkdirSync(home, { recursive: true });
    writeFileSync(unrelated, "keep");
    writeFileSync(join(home, "config.json"), "{}\n");

    const store = new ClipStore({ homeDir: home });
    try {
      store.createTextClip({ text: "hello" });
    } finally {
      store.close();
    }

    const result = purgeClipStore({ homeDir: home, confirm: true });

    expect(result.removed).toBe(true);
    expect(result.homeRemoved).toBe(false);
    expect(existsSync(join(home, "clip.db"))).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("requires explicit confirmation for direct purge calls", () => {
    const home = join(dir, "unconfirmed-home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.json"), "{}\n");

    expect(() => purgeClipStore({ homeDir: home })).toThrow("explicit confirmation");
    expect(existsSync(join(home, "config.json"))).toBe(true);
  });

  it("refuses custom data paths outside the clip home instead of silently skipping them", () => {
    const home = join(dir, "custom-home");
    const dbPath = join(dir, "external", "clip.db");
    const artifactDir = join(dir, "external", "artifacts");

    const store = new ClipStore({ homeDir: home, dbPath, artifactDir });
    try {
      const record = store.createBufferClip({
        buffer: new TextEncoder().encode("artifact"),
        kind: "file",
        mimeType: "text/plain",
      });
      expect(existsSync(record.artifactPath ?? "")).toBe(true);
    } finally {
      store.close();
    }
    writeFileSync(join(home, "config.json"), "{}\n");

    expect(() => purgeClipStore({ homeDir: home, dbPath, artifactDir, confirm: true })).toThrow("outside clip home");
    expect(existsSync(home)).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(artifactDir)).toBe(true);
    expect(existsSync(join(home, "config.json"))).toBe(true);
  });

  it("prunes expired shares and orphaned artifacts while keeping non-expired shares", () => {
    const expiredFile = join(dir, "expired.txt");
    const activeFile = join(dir, "active.txt");
    const deletedFile = join(dir, "deleted.txt");
    writeFileSync(expiredFile, "expired");
    writeFileSync(activeFile, "active");
    writeFileSync(deletedFile, "deleted");

    const store = new ClipStore({ homeDir: dir });
    try {
      const expired = store.createFileClip({ path: expiredFile, expiresAt: "2000-01-01T00:00:00.000Z" });
      const expiredText = store.createTextClip({ text: "old text", expiresAt: "2000-01-01T00:00:00.000Z" });
      const active = store.createFileClip({ path: activeFile, expiresAt: "2999-01-01T00:00:00.000Z" });
      const deleted = store.createFileClip({ path: deletedFile });
      expect(store.deleteClip(deleted.id)).toBe(true);
      const orphanPath = join(store.artifactDir, `${crypto.randomUUID()}.bin`);
      const unrelatedPath = join(store.artifactDir, "notes.txt");
      writeFileSync(orphanPath, "orphan");
      writeFileSync(unrelatedPath, "not a generated clip artifact");

      expect(store.getClip(expired.id)).toBeNull();
      expect(store.getClip(active.id)?.id).toBe(active.id);
      expect(store.status()).toMatchObject({ totalActive: 1, expired: 2, deleted: 1 });

      const preview = store.pruneExpiredShares({ now: "2026-01-01T00:00:00.000Z" });
      expect(preview.dryRun).toBe(true);
      expect(preview.prunedShares).toBe(0);
      expect(preview.expiredShares.map((share) => share.id).sort()).toEqual([expired.id, expiredText.id].sort());
      expect(preview.artifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining([
        expired.artifactPath!,
        deleted.artifactPath!,
        orphanPath,
      ]));
      expect(existsSync(expired.artifactPath!)).toBe(true);
      expect(existsSync(active.artifactPath!)).toBe(true);
      expect(existsSync(orphanPath)).toBe(true);
      expect(existsSync(unrelatedPath)).toBe(true);

      const applied = store.pruneExpiredShares({ dryRun: false, now: "2026-01-01T00:00:00.000Z" });
      expect(applied.prunedShares).toBe(2);
      expect(applied.removedArtifacts).toBe(3);
      expect(store.getClip(expired.id, { includeDeleted: true })?.deletedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(store.getClip(active.id)?.id).toBe(active.id);
      expect(existsSync(expired.artifactPath!)).toBe(false);
      expect(existsSync(active.artifactPath!)).toBe(true);
      expect(existsSync(deleted.artifactPath!)).toBe(false);
      expect(existsSync(orphanPath)).toBe(false);
      expect(existsSync(unrelatedPath)).toBe(true);
    } finally {
      store.close();
    }
  });
});
