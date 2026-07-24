import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPublicTextSurfaces } from "./public-release-files.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "todos-public-text-"));
  roots.push(root);
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "README.md"), "bun install -g @hasna/todos\n");
  writeFileSync(join(root, "docs", "guide.md"), "guide\n");
  writeFileSync(join(root, "src", "ignored.ts"), "ignored\n");
  return root;
}

describe("descriptor-anchored public release text traversal", () => {
  test("collects only bounded public surfaces in byte order", () => {
    const root = fixture();
    expect(collectPublicTextSurfaces(root)).toEqual([
      { path: "README.md", text: "bun install -g @hasna/todos\n" },
      { path: "docs/guide.md", text: "guide\n" },
    ]);
  });

  test("rejects symlinks and specials without following or blocking on them", () => {
    const symlinkRoot = fixture();
    symlinkSync(join(symlinkRoot, "README.md"), join(symlinkRoot, "docs", "link.md"));
    expect(() => collectPublicTextSurfaces(symlinkRoot)).toThrow(/rejected symlink/);

    const specialRoot = fixture();
    const fifo = join(specialRoot, "docs", "special.md");
    const mkfifo = Bun.spawnSync(["mkfifo", fifo], { stdout: "pipe", stderr: "pipe" });
    expect(mkfifo.exitCode).toBe(0);
    expect(() => collectPublicTextSurfaces(specialRoot)).toThrow(/rejected special file/);
  });

  test("enforces depth and entry bounds before traversal expands", () => {
    const depthRoot = fixture();
    expect(() => collectPublicTextSurfaces(depthRoot, { maxDepth: 0 })).toThrow(/exceeds depth 0/);

    const entryRoot = fixture();
    expect(() => collectPublicTextSurfaces(entryRoot, { maxEntries: 1 })).toThrow(/exceeds 1 entries/);
  });

  test("enforces per-file and aggregate bounds before reads", () => {
    const fileRoot = fixture();
    expect(() => collectPublicTextSurfaces(fileRoot, { maxFileBytes: 4 })).toThrow(/exceeds 4 bytes/);

    const aggregateRoot = fixture();
    const readmeBytes = Buffer.byteLength("bun install -g @hasna/todos\n");
    expect(() => collectPublicTextSurfaces(aggregateRoot, { maxAggregateBytes: readmeBytes }))
      .toThrow(/aggregate bytes/);
  });
});
