import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClipStore } from "./storage.js";

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
});
