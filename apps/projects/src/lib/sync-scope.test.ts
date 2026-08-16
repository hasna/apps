import { describe, expect, test } from "bun:test";
import {
  type DirectoryProbe,
  classifyDirectory,
  classifyFile,
} from "./sync-scope.js";

/** A probe over a fixed child list. */
function probeOf(children: string[]): DirectoryProbe {
  return { hasChild: (name: string) => children.includes(name) };
}

describe("sync scope: directories", () => {
  test("prunes an arbitrarily named dependency tree by its marker file", () => {
    // The measured case: a 155 MB virtualenv at `.venv-media`, which no
    // {.venv,venv} name list matches. It carries `pyvenv.cfg` at its root.
    const decision = classifyDirectory(".venv-media", {
      probe: probeOf(["bin", "include", "lib", "lib64", "pyvenv.cfg", "share"]),
    });
    expect(decision.include).toBe(false);
    expect(decision.reason).toBe("dependency-tree");
    expect(decision.rule).toBe("marker:pyvenv.cfg");
  });

  test("a name list alone would have missed that directory", () => {
    // Negative control for the rule above: without the probe there is no
    // marker to see, and `.venv-media` matches no name rule — so it is carried.
    // This is what makes the marker rule load-bearing rather than decorative.
    expect(classifyDirectory(".venv-media").include).toBe(true);
  });

  test("prunes conventionally named generated trees", () => {
    for (const name of ["node_modules", ".terraform", "dist", "__pycache__", ".next"]) {
      expect(classifyDirectory(name).include).toBe(false);
    }
    expect(classifyDirectory("node_modules").reason).toBe("dependency-tree");
    expect(classifyDirectory(".terraform").reason).toBe("provider-cache");
    expect(classifyDirectory("dist").reason).toBe("build-output");
    expect(classifyDirectory("__pycache__").reason).toBe("tool-cache");
  });

  test("prunes vcs internals and root worktrees", () => {
    expect(classifyDirectory(".git").reason).toBe("vcs-internal");
    expect(classifyDirectory("worktrees", { depth: 0 }).reason).toBe("nested-worktrees");
  });

  test("only prunes worktrees at the workspace root", () => {
    // A nested directory that happens to be called `worktrees` is ordinary
    // content; the census case was a checkout root.
    expect(classifyDirectory("worktrees", { depth: 2 }).include).toBe(true);
  });

  test("carries ordinary project directories", () => {
    for (const name of ["src", "docs", "reports", "briefs", "directives", "contracts", "evidence"]) {
      expect(classifyDirectory(name).include).toBe(true);
    }
  });

  test("a directory that merely resembles a build dir by prefix is carried", () => {
    // Exclusions are exact-name, never prefix or substring: `distribution` and
    // `building` are content.
    for (const name of ["distribution", "building", "node_modules_notes", "buildings"]) {
      expect(classifyDirectory(name).include).toBe(true);
    }
  });
});

describe("sync scope: files", () => {
  test("excludes database files and their sidecars", () => {
    for (const name of [
      "project.db",
      "sessions.local.sqlite",
      "store.sqlite3",
      "project.db-wal",
      "project.db-shm",
      "sessions.sqlite-journal",
    ]) {
      const decision = classifyFile(name);
      expect(decision.include).toBe(false);
      expect(decision.reason).toBe("regenerable-database");
    }
  });

  test("carries documents and images regardless of type", () => {
    // The surviving corpus is 20% PDF and 11% JPEG by bytes, and the largest
    // are incorporation records and signed tax declarations. Losing these to a
    // "skip binaries" rule is the expensive failure, not carrying them.
    for (const name of [
      "articles-of-incorporation.pdf",
      "d700-signed.PDF",
      "scan-0001.jpg",
      "logo.png",
      "recording.mp4",
      "archive.zip",
    ]) {
      expect(classifyFile(name).include).toBe(true);
    }
  });

  test("carries unknown extensions and extensionless files", () => {
    for (const name of ["GOALS.md", "Makefile", "notes", "data.parquet", ".env.example"]) {
      expect(classifyFile(name).include).toBe(true);
    }
  });

  test("size never excludes unless a caller opts in", () => {
    const huge = 9_000_000_000;
    // Default: no ceiling, so an enormous document is still carried.
    expect(classifyFile("board-pack.pdf", { size: huge }).include).toBe(true);
    // Opt-in ceiling.
    const capped = classifyFile("board-pack.pdf", { size: huge, maxFileBytes: 100_000_000 });
    expect(capped.include).toBe(false);
    expect(capped.reason).toBe("oversize");
    // And a file under the same ceiling is carried, so the rule can both fire
    // and stay silent.
    expect(classifyFile("board-pack.pdf", { size: 1_000, maxFileBytes: 100_000_000 }).include).toBe(true);
  });

  test("a size ceiling with no measured size cannot exclude", () => {
    expect(classifyFile("unknown.bin", { maxFileBytes: 1 }).include).toBe(true);
  });

  test("database matching is case-insensitive but anchored to the extension", () => {
    expect(classifyFile("Sessions.SQLite").include).toBe(false);
    // `.db` must be the extension, not a substring of the name.
    expect(classifyFile("dbnotes.md").include).toBe(true);
    expect(classifyFile("thunderbird-backup.txt").include).toBe(true);
  });
});

describe("sync scope: the shape of the result", () => {
  test("an included decision carries no reason", () => {
    const decision = classifyFile("GOALS.md");
    expect(decision.include).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  test("every exclusion names a reason and the rule that decided", () => {
    const decisions = [
      classifyDirectory("node_modules"),
      classifyDirectory(".venv-x", { probe: probeOf(["pyvenv.cfg"]) }),
      classifyFile("project.db"),
    ];
    for (const decision of decisions) {
      expect(decision.include).toBe(false);
      expect(typeof decision.reason).toBe("string");
      expect(typeof decision.rule).toBe("string");
    }
  });
});
