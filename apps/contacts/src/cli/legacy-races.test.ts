import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preserveLegacyDatabase } from "./legacy.js";

const roots: string[] = [];
const restores: Array<() => void> = [];

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "contacts-legacy-race-"));
  roots.push(root);
  const source = join(root, "contacts.db");
  const output = join(root, "preserved.db");
  fs.writeFileSync(source, "original database");
  return { root, source, output };
}

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("legacy preservation pathname races", () => {
  test("never deletes an unrelated replacement output after a late sidecar", () => {
    const { source, output, root } = fixture();
    const savedCopy = join(root, "moved-copy.db");
    const originalFsync = fs.fsyncSync;
    const spy = spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      originalFsync(fd);
      fs.renameSync(output, savedCopy);
      fs.writeFileSync(output, "unrelated replacement");
      fs.writeFileSync(`${source}-wal`, "late transaction");
    });
    restores.push(() => spy.mockRestore());

    expect(() => preserveLegacyDatabase(source, output)).toThrow("unverified");
    expect(fs.readFileSync(output, "utf8")).toBe("unrelated replacement");
    expect(fs.readFileSync(source, "utf8")).toBe("original database");
    expect(fs.readFileSync(savedCopy, "utf8")).toBe("original database");
  });

  test("rejects a regular source replacement immediately before open", () => {
    const { source, output, root } = fixture();
    const originalOpen = fs.openSync;
    let swapped = false;
    const spy = spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (String(path) === source && !swapped) {
        swapped = true;
        fs.renameSync(source, join(root, "original.db"));
        fs.writeFileSync(source, "substituted database");
      }
      return originalOpen(path, flags, mode);
    });
    restores.push(() => spy.mockRestore());

    expect(() => preserveLegacyDatabase(source, output)).toThrow("between inspection and opening");
    expect(swapped).toBe(true);
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe("substituted database");
  });

  test("rejects an ancestor-link swap even when it resolves to the same source inode", () => {
    const { root, output } = fixture();
    const directory = join(root, "source-dir");
    const renamed = join(root, "moved-source-dir");
    fs.mkdirSync(directory);
    const source = join(directory, "contacts.db");
    fs.writeFileSync(source, "original database");
    const originalOpen = fs.openSync;
    let swapped = false;
    const spy = spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (String(path) === source && !swapped) {
        swapped = true;
        fs.renameSync(directory, renamed);
        fs.symlinkSync(renamed, directory, "dir");
      }
      return originalOpen(path, flags, mode);
    });
    restores.push(() => spy.mockRestore());

    expect(() => preserveLegacyDatabase(source, output)).toThrow("between inspection and opening");
    expect(swapped).toBe(true);
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.readFileSync(source, "utf8")).toBe("original database");
  });
});
