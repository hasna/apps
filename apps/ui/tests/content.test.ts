import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  CONTENT_DIR_ENV,
  MissingContentMirrorError,
  assertContentMirror,
  contentSetupMessage,
  hasContentMirror,
  resolveContentDir,
  uidotshUriToRelativePath,
  uriToContentFile,
} from "../src/content.ts";

const originalContentDir = process.env[CONTENT_DIR_ENV];

afterEach(() => {
  if (originalContentDir === undefined) delete process.env[CONTENT_DIR_ENV];
  else process.env[CONTENT_DIR_ENV] = originalContentDir;
});

describe("resolveContentDir", () => {
  test("resolves an explicit relative directory from the current working directory", () => {
    expect(resolveContentDir("fixtures/content")).toBe(resolve(process.cwd(), "fixtures/content"));
  });

  test("preserves an explicit absolute directory", () => {
    const absolute = join(tmpdir(), "ui-content-absolute");
    expect(isAbsolute(absolute)).toBe(true);
    expect(resolveContentDir(absolute)).toBe(absolute);
  });

  test("prefers an explicit argument over the environment", () => {
    process.env[CONTENT_DIR_ENV] = "from-environment";
    expect(resolveContentDir("from-argument")).toBe(resolve(process.cwd(), "from-argument"));
  });

  test("uses the environment when no explicit directory is supplied", () => {
    process.env[CONTENT_DIR_ENV] = "from-environment";
    expect(resolveContentDir()).toBe(resolve(process.cwd(), "from-environment"));
  });

});

describe("uidotshUriToRelativePath", () => {
  test("maps root and nested resources to markdown paths", () => {
    expect(uidotshUriToRelativePath("uidotsh://ui")).toBe("ui.md");
    expect(uidotshUriToRelativePath("uidotsh://ui/design-guidelines/forms")).toBe(
      "ui/design-guidelines/forms.md",
    );
  });

  test("removes repeated sentence punctuation only from the end", () => {
    expect(uidotshUriToRelativePath("uidotsh://ui/ideas).,")).toBe("ui/ideas.md");
    expect(uidotshUriToRelativePath("uidotsh://ui/a,b")).toBe("ui/a,b.md");
  });

  test("rejects empty, dotted, and backslash path segments", () => {
    for (const uri of [
      "uidotsh://ui//ideas",
      "uidotsh://ui/./ideas",
      "uidotsh://ui/../ideas",
      "uidotsh://ui/design\\ideas",
    ]) {
      expect(() => uidotshUriToRelativePath(uri)).toThrow(/Unsafe uidotsh URI path/);
    }
  });

  test("rejects lookalike schemes and unsupported roots", () => {
    expect(() => uidotshUriToRelativePath("uidotshs://ui")).toThrow(/Not a uidotsh URI/);
    expect(() => uidotshUriToRelativePath("uidotsh://uikit")).toThrow(/Unsupported uidotsh URI/);
  });
});

describe("content mirror boundary", () => {
  test("requires both mirror marker files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hasna-ui-mirror-boundary-"));
    try {
      expect(await hasContentMirror(dir)).toBe(false);
      await writeFile(join(dir, "ui.md"), "# UI\n");
      expect(await hasContentMirror(dir)).toBe(false);
      await writeFile(join(dir, "index.json"), "{}\n");
      expect(await hasContentMirror(dir)).toBe(true);
      await expect(assertContentMirror(dir)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("reports the exact missing directory through a typed error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hasna-ui-mirror-missing-"));
    try {
      try {
        await assertContentMirror(dir);
        throw new Error("expected assertContentMirror to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(MissingContentMirrorError);
        expect((error as MissingContentMirrorError).contentDir).toBe(dir);
        expect((error as Error).name).toBe("MissingContentMirrorError");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("setup guidance names the recovery command and configuration variable", () => {
    const dir = join(tmpdir(), "missing-ui-content");
    const message = contentSetupMessage(dir);
    expect(message).toContain(dir);
    expect(message).toContain("ui harvest");
    expect(message).toContain(CONTENT_DIR_ENV);
    expect(message).toContain("ui.md and index.json");
  });

  test("content file resolution stays rooted under the requested mirror", () => {
    const dir = join(tmpdir(), "ui-content-root");
    expect(uriToContentFile("uidotsh://ui/design-guidelines/forms", dir)).toBe(
      join(dir, "ui/design-guidelines/forms.md"),
    );
    expect(() => uriToContentFile("uidotsh://ui/../../outside", dir)).toThrow(/Unsafe uidotsh URI path/);
  });
});
