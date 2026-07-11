import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanRoot, isBinaryFile, hasBinaryExtension, isContentExcluded, extOf } from "./walker.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "search-walker-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content = "x") {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("scanRoot", () => {
  test("finds files recursively with metadata", () => {
    write("a.ts", "const a = 1;");
    write("src/b.ts", "const b = 2;");
    write("src/deep/c.md", "# c");

    const files = scanRoot(root).files;
    expect(files.map((f) => f.relPath)).toEqual(["a.ts", "src/b.ts", "src/deep/c.md"]);
    const b = files.find((f) => f.relPath === "src/b.ts")!;
    expect(b.name).toBe("b.ts");
    expect(b.ext).toBe("ts");
    expect(b.dir).toBe("src");
    expect(b.size).toBe(12);
    expect(b.mtimeMs).toBeGreaterThan(0);
  });

  test("skips default-excluded directories", () => {
    write("node_modules/pkg/index.js");
    write(".git/HEAD");
    write("dist/out.js");
    write("src/keep.ts");

    const files = scanRoot(root).files;
    expect(files.map((f) => f.relPath)).toEqual(["src/keep.ts"]);
  });

  test("honors .gitignore at root", () => {
    write(".gitignore", "*.log\nsecret/\n");
    write("app.log");
    write("secret/key.txt");
    write("app.ts");

    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).toContain("app.ts");
    expect(rels).toContain(".gitignore");
    expect(rels).not.toContain("app.log");
    expect(rels).not.toContain("secret/key.txt");
  });

  test("honors nested .gitignore scoped to its directory", () => {
    write("sub/.gitignore", "*.tmp\n");
    write("sub/x.tmp");
    write("y.tmp");

    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).not.toContain("sub/x.tmp");
    expect(rels).toContain("y.tmp");
  });

  test("negation in nested .gitignore wins over root", () => {
    write(".gitignore", "*.log\n");
    write("sub/.gitignore", "!keep.log\n");
    write("sub/keep.log");
    write("sub/drop.log");

    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).toContain("sub/keep.log");
    expect(rels).not.toContain("sub/drop.log");
  });

  test("applies extra excludes", () => {
    write("data/big.csv");
    write("src/a.ts");
    const rels = scanRoot(root, ["data/"]).files.map((f) => f.relPath);
    expect(rels).toEqual(["src/a.ts"]);
  });

  test("skips symlinks", () => {
    write("real.txt");
    symlinkSync(join(root, "real.txt"), join(root, "link.txt"));
    symlinkSync(root, join(root, "cycle"));

    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).toEqual(["real.txt"]);
  });

  test("handles files with spaces and unicode", () => {
    write("my file (1).txt");
    write("naïve-café.md");
    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).toContain("my file (1).txt");
    expect(rels).toContain("naïve-café.md");
  });

  test("gitignore negation cannot re-include default excludes", () => {
    write(".gitignore", "!.git/\n!.git/**\n!node_modules/\n!node_modules/**\n!dist/\n");
    write(".git/credentials", "token=secret");
    write("node_modules/pkg/index.js");
    write("dist/out.js");
    write("src/keep.ts");

    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).not.toContain(".git/credentials");
    expect(rels).not.toContain("node_modules/pkg/index.js");
    expect(rels).not.toContain("dist/out.js");
    expect(rels).toContain("src/keep.ts");
  });

  test("per-root exclude negation cannot re-include protected defaults", () => {
    write("dist/out.js");
    const rels = scanRoot(root, ["!dist/"]).files.map((f) => f.relPath);
    expect(rels).not.toContain("dist/out.js");
  });

  test("skips protected secrets, provider DBs, and sqlite sidecars", () => {
    write(".ssh/id_rsa", "secret");
    write(".aws/credentials", "secret");
    write(".codewith/logs_2.sqlite-wal", "wal");
    write("data/mail.db-wal", "wal");
    write("data/mail.db-shm", "shm");
    write("safe/readme.md", "ok");

    const rels = scanRoot(root).files.map((f) => f.relPath);
    expect(rels).toEqual(["safe/readme.md"]);
  });

  test("unreadable root throws instead of returning empty", () => {
    expect(() => scanRoot(join(root, "missing-dir"))).toThrow(/Cannot read index root/);
  });
});

describe("binary detection", () => {
  test("hasBinaryExtension", () => {
    expect(hasBinaryExtension("png")).toBe(true);
    expect(hasBinaryExtension("ts")).toBe(false);
  });

  test("isBinaryFile sniffs null bytes", () => {
    const textPath = join(root, "t.txt");
    writeFileSync(textPath, "hello world");
    expect(isBinaryFile(textPath)).toBe(false);

    const binPath = join(root, "b.dat");
    writeFileSync(binPath, Buffer.from([0x68, 0x00, 0x65]));
    expect(isBinaryFile(binPath)).toBe(true);

    expect(isBinaryFile(join(root, "missing.txt"))).toBe(true);
  });

  test("isContentExcluded", () => {
    expect(isContentExcluded("bun.lock")).toBe(true);
    expect(isContentExcluded("package-lock.json")).toBe(true);
    expect(isContentExcluded("app.min.js")).toBe(true);
    expect(isContentExcluded("bundle.js.map")).toBe(true);
    expect(isContentExcluded("logo.svg")).toBe(true);
    expect(isContentExcluded("index.ts")).toBe(false);
  });

  test("extOf", () => {
    expect(extOf("a.ts")).toBe("ts");
    expect(extOf("a.test.TS")).toBe("ts");
    expect(extOf("Makefile")).toBe("");
    expect(extOf(".gitignore")).toBe("");
  });
});
