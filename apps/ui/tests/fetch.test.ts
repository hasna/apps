import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTENT_DIR_ENV,
  MissingContentMirrorError,
  assertContentMirror,
  hasContentMirror,
} from "../src/content.ts";
import { uriToFile, fetchOne, fetchMany, fetchResource } from "../src/fetch.ts";
import {
  ROOT_BODY,
  createSyntheticMirror,
  corruptIndex,
  removeMirrorFile,
  withMirror,
  type SyntheticMirror,
} from "./helpers/synthetic-mirror.ts";

const originalContentDir = process.env[CONTENT_DIR_ENV];

afterEach(() => {
  if (originalContentDir === undefined) delete process.env[CONTENT_DIR_ENV];
  else process.env[CONTENT_DIR_ENV] = originalContentDir;
});

function runCli(args: string[], env: Record<string, string> = {}): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", "src/cli.ts", ...args],
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe("uriToFile", () => {
  test("maps the root resource", () => {
    expect(uriToFile("uidotsh://ui", "/any/dir")).toBe(join("/any/dir", "ui.md"));
  });
  test("maps a nested guideline resource", () => {
    expect(uriToFile("uidotsh://ui/design-guidelines/buttons", "/any/dir")).toBe(
      join("/any/dir", "ui/design-guidelines/buttons.md"),
    );
  });
  test("strips trailing punctuation from a uri", () => {
    expect(uriToFile("uidotsh://ui/ideas).", "/any/dir")).toBe(join("/any/dir", "ui/ideas.md"));
  });
  test("rejects a non-uidotsh uri", () => {
    expect(() => uriToFile("https://ui.sh/ui")).toThrow();
  });
  test("rejects unsupported or unsafe uidotsh paths", () => {
    expect(() => uriToFile("uidotsh://../secret", "/any/dir")).toThrow(/Unsupported uidotsh URI|Unsafe uidotsh URI/);
    expect(() => uriToFile("uidotsh://ui/../../secret", "/any/dir")).toThrow(/Unsafe uidotsh URI/);
    expect(() => uriToFile("uidotsh://other/resource", "/any/dir")).toThrow(/Unsupported uidotsh URI/);
  });
});

describe("fetchOne (synthetic mirror)", () => {
  test("root resource lists the subskills", async () => {
    await withMirror(45, async (mirror) => {
      const text = await fetchOne("uidotsh://ui", { contentDir: mirror.dir });
      expect(text).toContain("Subskills");
      expect(text).toContain("design");
    });
  });

  test("returns the complete indexed population", async () => {
    await withMirror(45, async (mirror) => {
      const idx = (await Bun.file(join(mirror.dir, "index.json")).json()) as Record<string, string>;
      for (const uri of Object.keys(idx)) {
        const text = await fetchOne(uri, { contentDir: mirror.dir });
        expect(text.length).toBeGreaterThan(0);
      }
      expect(Object.keys(idx).length).toBeGreaterThanOrEqual(40);
    });
  });

  test("preserves contentDir-relative paths and content", async () => {
    await withMirror(45, async (mirror) => {
      const rel = "ui/design-guidelines/buttons.md";
      const text = await fetchOne("uidotsh://ui/design-guidelines/buttons", { contentDir: mirror.dir });
      expect(await Bun.file(join(mirror.dir, rel)).text()).toBe(text);
      expect(uriToFile("uidotsh://ui/design-guidelines/buttons", mirror.dir)).toBe(join(mirror.dir, rel));
      const idx = (await Bun.file(join(mirror.dir, "index.json")).json()) as Record<string, string>;
      expect(idx["uidotsh://ui/design-guidelines/buttons"]).toBe(rel);
    });
  });

  test("missing resource throws the typed missing-resource failure", async () => {
    await withMirror(45, async (mirror) => {
      const uri = "uidotsh://ui/design-guidelines/buttons";
      const before = await fetchOne(uri, { contentDir: mirror.dir });
      expect(before.length).toBeGreaterThan(0);
      await removeMirrorFile(mirror, uri);
      await expect(fetchOne(uri, { contentDir: mirror.dir })).rejects.toThrow(
        new RegExp(`No mirrored resource for ${uri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
    });
  });
});

describe("fetchMany", () => {
  test("concatenates multiple resources with headers", async () => {
    await withMirror(45, async (mirror) => {
      const text = await fetchMany(["uidotsh://ui/ideas", "uidotsh://ui/componentize"], { contentDir: mirror.dir });
      expect(text).toContain("## uidotsh://ui/ideas");
      expect(text).toContain("## uidotsh://ui/componentize");
      expect(text.indexOf("## uidotsh://ui/ideas")).toBeLessThan(text.indexOf("## uidotsh://ui/componentize"));
    });
  });

  test("embeds an ERROR line for one missing resource while continuing", async () => {
    await withMirror(45, async (mirror) => {
      await removeMirrorFile(mirror, "uidotsh://ui/ideas");
      const text = await fetchMany(["uidotsh://ui/ideas", "uidotsh://ui/componentize"], { contentDir: mirror.dir });
      expect(text).toContain("> ERROR: No mirrored resource for uidotsh://ui/ideas");
      expect(text).toContain("## uidotsh://ui/componentize");
      expect(text).toContain(await fetchOne("uidotsh://ui/componentize", { contentDir: mirror.dir }));
    });
  });

  test("rethrows the typed mirror failure instead of swallowing it", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "hasna-ui-empty-"));
    try {
      await expect(fetchMany(["uidotsh://ui", "uidotsh://ui/ideas"], { contentDir: emptyDir })).rejects.toBeInstanceOf(
        MissingContentMirrorError,
      );
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("fetchResource argument precedence", () => {
  test("uris takes precedence over uri", async () => {
    await withMirror(45, async (mirror) => {
      const text = await fetchResource({
        uri: "uidotsh://ui",
        uris: ["uidotsh://ui/ideas", "uidotsh://ui/componentize"],
        contentDir: mirror.dir,
      });
      expect(text).toContain("# Batch Fetch");
      expect(text).toContain("## uidotsh://ui/ideas");
      expect(text).toContain("## uidotsh://ui/componentize");
    });
  });

  test("uri is the fallback when uris is absent or empty", async () => {
    await withMirror(45, async (mirror) => {
      const text = await fetchResource({ uri: "uidotsh://ui", contentDir: mirror.dir });
      expect(text).toBe(ROOT_BODY);
      expect(text).not.toContain("# Batch Fetch");
      const empty = await fetchResource({ uri: "uidotsh://ui", uris: [], contentDir: mirror.dir });
      expect(empty).toBe(ROOT_BODY);
    });
  });

  test("neither uri nor uris produces the explicit guidance error", async () => {
    await withMirror(45, async (mirror) => {
      await expect(fetchResource({ contentDir: mirror.dir })).rejects.toThrow("Provide `uri` or `uris`");
      await expect(fetchResource({ uri: "", uris: [], contentDir: mirror.dir })).rejects.toThrow(
        "Provide `uri` or `uris`",
      );
    });
  });
});

describe("missing content mirror guidance", () => {
  test("single and batch fetches fail with setup guidance when content is absent", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "hasna-ui-empty-"));
    try {
      process.env[CONTENT_DIR_ENV] = emptyDir;
      await expect(fetchOne("uidotsh://ui")).rejects.toThrow(/does not redistribute ui\.sh content/);
      await expect(fetchMany(["uidotsh://ui", "uidotsh://ui/ideas"])).rejects.toThrow(/ui harvest/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  test("a mirror missing its index file is not a mirror", async () => {
    await withMirror(45, async (mirror) => {
      const dir = mirror.dir;
      expect(await hasContentMirror(dir)).toBe(true);
      await rm(join(dir, "index.json"));
      expect(await hasContentMirror(dir)).toBe(false);
      await expect(assertContentMirror(dir)).rejects.toBeInstanceOf(MissingContentMirrorError);
      await expect(fetchOne("uidotsh://ui", { contentDir: dir })).rejects.toBeInstanceOf(MissingContentMirrorError);
    });
  });

  test("a corrupt index fails rather than silently passing", async () => {
    await withMirror(45, async (mirror) => {
      await corruptIndex(mirror);
      // The index is the mirror's resource map; a corrupt one must not be
      // served as a healthy mirror.
      await expect(fetchOne("uidotsh://ui", { contentDir: mirror.dir })).rejects.toBeInstanceOf(
        MissingContentMirrorError,
      );
      await expect(fetchMany(["uidotsh://ui/ideas"], { contentDir: mirror.dir })).rejects.toBeInstanceOf(
        MissingContentMirrorError,
      );
    });
  });
});

describe("content tree completeness", () => {
  test("index.json mirrors the full resource set (>= 40)", async () => {
    await withMirror(45, async (mirror) => {
      const idx = (await Bun.file(join(mirror.dir, "index.json")).json()) as Record<string, string>;
      const keys = Object.keys(idx);
      expect(keys.length).toBeGreaterThanOrEqual(40);
      expect(keys).toContain("uidotsh://ui");
      expect(keys).toContain("uidotsh://ui/design-guidelines/typography");
    });
  });
});

describe("ui list CLI", () => {
  test("caps human output and pages json when requested", async () => {
    await withMirror(45, async (mirror) => {
      const env = { [CONTENT_DIR_ENV]: mirror.dir };
      const human = runCli(["list", "--limit", "3"], env);
      expect(human.exitCode).toBe(0);
      expect(human.stdout.trim().split("\n")).toHaveLength(3);
      expect(human.stderr).toContain("3 of");
      expect(human.stderr).toContain("--cursor 3");

      const json = runCli(["list", "--limit=2", "--cursor=2", "--json"], env);
      expect(json.exitCode).toBe(0);
      expect(JSON.parse(json.stdout)).toHaveLength(2);

      const missing = runCli(["list", "--limit"], env);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("--limit requires a value");

      const emptyEquals = runCli(["list", "--limit="], env);
      expect(emptyEquals.exitCode).toBe(1);
      expect(emptyEquals.stderr).toContain("--limit requires a value");
    });
  });

  test("returns different rows for the first page and a later cursor page", async () => {
    await withMirror(45, async (mirror) => {
      const env = { [CONTENT_DIR_ENV]: mirror.dir };
      const page0 = runCli(["list", "--limit", "10", "--json"], env);
      const page1 = runCli(["list", "--limit", "10", "--cursor", "10", "--json"], env);
      expect(page0.exitCode).toBe(0);
      expect(page1.exitCode).toBe(0);
      const a = JSON.parse(page0.stdout) as string[];
      const b = JSON.parse(page1.stdout) as string[];
      expect(a).toHaveLength(10);
      expect(b).toHaveLength(10);
      for (const row of a) expect(b).not.toContain(row);
    });
  });

  test("full json shape differs from the paged json shape", async () => {
    await withMirror(45, async (mirror) => {
      const env = { [CONTENT_DIR_ENV]: mirror.dir };
      const full = runCli(["list", "--json"], env);
      const paged = runCli(["list", "--json", "--limit", "5"], env);
      expect(full.exitCode).toBe(0);
      expect(paged.exitCode).toBe(0);
      const all = JSON.parse(full.stdout) as string[];
      const rows = JSON.parse(paged.stdout) as string[];
      expect(all.length).toBe(45);
      expect(rows).toHaveLength(5);
      expect(all).toEqual([...all].sort());
      expect(rows).toEqual(all.slice(0, 5));
    });
  });

  test("rejects zero, negative, and non-integer limits", async () => {
    await withMirror(45, async (mirror) => {
      const env = { [CONTENT_DIR_ENV]: mirror.dir };
      for (const bad of ["0", "-1", "1.5", "abc"]) {
        const proc = runCli(["list", "--limit", bad], env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr).toContain("--limit must be a positive integer");
      }
    });
  });

  test("rejects negative and NaN cursors", async () => {
    await withMirror(45, async (mirror) => {
      const env = { [CONTENT_DIR_ENV]: mirror.dir };
      for (const bad of ["-1", "abc", "1.5"]) {
        const proc = runCli(["list", "--cursor", bad], env);
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr).toContain("--cursor must be a non-negative integer");
      }
    });
  });

  test("rejects unknown list options", async () => {
    await withMirror(45, async (mirror) => {
      const proc = runCli(["list", "--bogus"], { [CONTENT_DIR_ENV]: mirror.dir });
      expect(proc.exitCode).toBe(1);
      expect(proc.stderr).toContain("Unknown list option(s): --bogus");
    });
  });

  test("fails rather than silently passing when the index is corrupt", async () => {
    const mirror: SyntheticMirror = await createSyntheticMirror(45);
    try {
      await corruptIndex(mirror);
      const proc = runCli(["list"], { [CONTENT_DIR_ENV]: mirror.dir });
      expect(proc.exitCode).toBe(1);
    } finally {
      await rm(mirror.dir, { recursive: true, force: true });
    }
  });
});
