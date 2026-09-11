/**
 * The exit-code table, driven directly against the executor.
 *
 * These are the measurements from GNU coreutils 9.4, restated as assertions —
 * including the ones a first draft gets wrong:
 *
 *   `-f` with NO operands is 0; `-i` clears that; `-i` after `-f` restores it;
 *   a missing path is silent under `-f` and an error without it; a directory is
 *   an error even under `-f`; `-d` on a plain file succeeds; `-I` triggers on
 *   `>3 operands || -r`; declining with `-i` is not a failure.
 *
 * Every fixture is a file this suite created inside a `mkdtemp` sandbox, and
 * the store the guard writes to is inside the same sandbox — nothing here can
 * reach a real path, and no `rm` is ever executed against one.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { TrashStore } from "../lib/store.js";
import { createSandbox, testEnv, type Sandbox } from "../testing/sandbox.js";
import { runGuard, type GuardRunOptions } from "./run.js";

let sandbox: Sandbox;
let spool: string;

beforeEach(() => {
  sandbox = createSandbox();
  spool = sandbox.path("spool");
});

afterEach(() => {
  sandbox.cleanup();
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  removed: number;
  refused: number;
  failed: number;
  questions: string[];
}

interface Harness {
  store: TrashStore;
  run(argv: string[], overrides?: Partial<GuardRunOptions>): RunResult;
}

function harness(config: Record<string, unknown> = {}): Harness {
  const store = new TrashStore({
    roots: { root: spool },
    env: testEnv(sandbox),
    config: { capture: { maxEntryBytes: 2 * 1024 * 1024, ...config } },
  });
  return {
    store,
    run(argv, overrides = {}) {
      const out: string[] = [];
      const err: string[] = [];
      const questions: string[] = [];
      // `ask` is intercepted so the questions can be asserted; the answer the
      // caller supplies is what the guard sees. The default answer is `false`,
      // which is exactly the EOF case ("no").
      const { ask: answer, ...rest } = overrides;
      const result = runGuard({
        argv,
        cwd: sandbox.root,
        io: { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
        store,
        ask: (question) => {
          questions.push(question);
          return answer ? answer(question) : false;
        },
        ...rest,
      });
      return { ...result, stdout: out.join(""), stderr: err.join(""), questions };
    },
  };
}

function outputSays(result: RunResult, needle: string): boolean {
  return `${result.stderr}${result.stdout}`.includes(needle);
}

/** A file fixture, created by this suite inside the sandbox. */
function file(relative: string, content = "x"): string {
  const target = sandbox.file(relative, content);
  return target;
}

describe("operands and the force bit", () => {
  test("`-f` with no operands exits 0, silently", () => {
    const result = harness().run(["-f"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("no operands without -f exits 1 with `missing operand`", () => {
    for (const argv of [[], ["-i"], ["-v"], ["-d"], ["--verbose", "--dir"]]) {
      const result = harness().run(argv);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.stderr, argv.join(" ")).toContain("missing operand");
    }
  });

  test("-f and -i are last-one-wins in argv order", () => {
    // `-i` clears the force bit, so it takes the missing-operand error with it;
    // `-f` after `-i` restores it. -f-always-wins gets both of these backwards.
    expect(harness().run(["-f", "-i"]).code).toBe(1);
    expect(harness().run(["-i", "-f"]).code).toBe(0);
    expect(harness().run(["-fi"]).code).toBe(1);
    expect(harness().run(["-if"]).code).toBe(0);
    expect(harness().run(["-f", "-I"]).code).toBe(1);
  });

  test("a missing path is silent success under -f and an error without it", () => {
    const missing = join(sandbox.root, "not-there");
    const forced = harness().run(["-f", missing]);
    expect(forced.code).toBe(0);
    expect(forced.stderr).toBe("");

    const plain = harness().run([missing]);
    expect(plain.code).toBe(1);
    expect(plain.stderr).toBe(`rm: cannot remove '${missing}': No such file or directory\n`);
  });

  test("a missing path prompts NOTHING under -i — the stat happens first", () => {
    const missing = join(sandbox.root, "not-there");
    const result = harness().run(["-i", missing]);
    expect(result.code).toBe(1);
    expect(result.questions).toEqual([]);
    expect(result.stderr).toContain("No such file or directory");
  });

  test("an empty operand is a missing path, not the cwd", () => {
    expect(harness().run([""]).code).toBe(1);
    expect(harness().run([""]).stderr).toContain("cannot remove '': No such file or directory");
    expect(harness().run(["-f", ""]).code).toBe(0);
    // The cwd itself is untouched by that first case.
    expect(existsSync(sandbox.root)).toBe(true);
  });

  test("--force and -f are the same option", () => {
    const missing = join(sandbox.root, "not-there");
    expect(harness().run(["--force", missing]).code).toBe(0);
    expect(harness().run(["--interactive=never", missing]).code).toBe(1);
  });
});

describe("directories", () => {
  test("a directory without -r or -d is an error, and -f does not suppress it", () => {
    const dir = sandbox.dir("plain");
    for (const argv of [[dir], ["-f", dir], ["-i", dir]]) {
      const result = harness().run(argv);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.stderr, argv.join(" ")).toContain(`cannot remove '${dir}': Is a directory`);
    }
    expect(existsSync(dir)).toBe(true);
  });

  test("-d removes an empty directory and refuses a non-empty one", () => {
    const empty = sandbox.dir("empty");
    const removed = harness().run(["-d", empty]);
    expect(removed.code).toBe(0);
    expect(existsSync(empty)).toBe(false);

    const full = sandbox.dir("full");
    sandbox.file("full/inner", "x");
    const refused = harness().run(["-d", full]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`cannot remove '${full}': Directory not empty`);
    expect(existsSync(full)).toBe(true);
  });

  test("-d on a plain file removes it", () => {
    const target = file("plain.txt");
    const result = harness().run(["-d", target]);
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  test("-r removes a tree, capturing it in the store", () => {
    const tree = sandbox.dir("tree");
    sandbox.file("tree/a/b/c.txt", "hello");
    const h = harness();
    const result = h.run(["-rf", tree]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(tree)).toBe(false);

    const entries = h.store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.originalPath).toBe(tree);
  });

  test("a symlink to a directory removes the LINK, never the target", () => {
    const target = sandbox.dir("target");
    sandbox.file("target/keep.txt", "keep");
    const link = sandbox.symlink(target, "link");
    const result = harness().run(["-rf", link]);
    expect(result.code).toBe(0);
    expect(lstatSync(target).isDirectory()).toBe(true);
    expect(existsSync(join(target, "keep.txt"))).toBe(true);
  });
});

describe("prompting (-i)", () => {
  test("a decline keeps the file and exits 0 — declining is not a failure", () => {
    const target = file("keep.txt");
    const result = harness().run(["-i", target], { ask: () => false });
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(result.questions).toEqual([`rm: remove regular file '${target}'? `]);
  });

  test("an accept removes it", () => {
    const target = file("go.txt");
    const result = harness().run(["-i", target], { ask: () => true });
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  test("EOF reads as `no` for every operand — the file is preserved and the command moves on", () => {
    // The `ask` default in this harness answers false, which is the EOF case.
    const first = file("one.txt");
    const second = file("two.txt");
    const result = harness().run(["-i", first, second]);
    expect(result.code).toBe(0);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(second)).toBe(true);
    expect(result.questions).toHaveLength(2);
  });

  test("the prompt names the type, GNU-style", () => {
    const empty = file("empty.txt", "");
    const normal = file("normal.txt", "content");
    expect(harness().run(["-i", empty, normal], { ask: () => false }).questions).toEqual([
      `rm: remove regular empty file '${empty}'? `,
      `rm: remove regular file '${normal}'? `,
    ]);
  });

  test("a write-protected file is named as such", () => {
    const target = file("ro.txt", "");
    Bun.spawnSync({ cmd: ["chmod", "444", target] });
    const result = harness().run(["-i", target], { ask: () => false });
    expect(result.questions).toEqual([`rm: remove write-protected regular empty file '${target}'? `]);
  });

  test("a directory under -r prompts for the tree, not for each child", () => {
    const dir = sandbox.dir("tree");
    sandbox.file("tree/child.txt", "x");
    sandbox.file("tree/deeper/leaf.txt", "y");
    const result = harness().run(["-ri", dir], { ask: () => false });
    expect(result.code).toBe(0);
    expect(existsSync(dir)).toBe(true);
    expect(result.questions).toEqual([`rm: descend into directory '${dir}'? `]);
  });

  test("a prompt that is accepted captures the whole tree", () => {
    const dir = sandbox.dir("tree");
    sandbox.file("tree/child.txt", "x");
    const result = harness().run(["-ri", dir], { ask: () => true });
    expect(result.code).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });
});

describe("prompting once (-I)", () => {
  test("does not trigger for three operands", () => {
    const files = [file("a"), file("b"), file("c")];
    const result = harness().run(["-I", ...files]);
    expect(result.questions).toEqual([]);
    expect(result.code).toBe(0);
    for (const f of files) expect(existsSync(f)).toBe(false);
  });

  test("triggers above three operands and a decline aborts the WHOLE command with 0", () => {
    const files = [file("a"), file("b"), file("c"), file("d")];
    const result = harness().run(["-I", ...files], { ask: () => false });
    expect(result.code).toBe(0);
    expect(result.questions).toEqual(["rm: remove 4 arguments? "]);
    for (const f of files) expect(existsSync(f)).toBe(true);
  });

  test("triggers on -r with a single operand and words it `recursively`", () => {
    const dir = sandbox.dir("tree");
    const result = harness().run(["-I", "-r", dir], { ask: () => false });
    expect(result.code).toBe(0);
    expect(result.questions).toEqual(["rm: remove 1 argument recursively? "]);
    expect(existsSync(dir)).toBe(true);
  });

  test("an accept proceeds without further prompting", () => {
    const files = [file("a"), file("b"), file("c"), file("d")];
    const result = harness().run(["-I", ...files], { ask: () => true });
    expect(result.code).toBe(0);
    expect(result.questions).toHaveLength(1);
    for (const f of files) expect(existsSync(f)).toBe(false);
  });
});

describe("verbosity", () => {
  test("-v reports a removed file and a removed directory on stdout", () => {
    const plain = file("plain.txt");
    expect(harness().run(["-v", plain]).stdout).toBe(`removed '${plain}'\n`);

    const dir = sandbox.dir("emptydir");
    expect(harness().run(["-v", "-d", dir]).stdout).toBe(`removed directory '${dir}'\n`);
  });

  test("-v stays silent about a declined prompt", () => {
    const target = file("keep.txt");
    const result = harness().run(["-v", "-i", target], { ask: () => false });
    expect(result.stdout).toBe("");
    expect(result.code).toBe(0);
  });

  test("stdout stays empty without -v", () => {
    const target = file("quiet.txt");
    const result = harness().run(["-rf", target]);
    expect(result.stdout).toBe("");
    expect(result.code).toBe(0);
  });
});

describe("option errors", () => {
  test("an unknown short option exits 1 with rm's wording", () => {
    const result = harness().run(["-Z", file("f")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("rm: invalid option -- 'Z'");
    expect(result.stderr).toContain("Try 'rm --help' for more information.");
  });

  test("an unknown long option exits 1 with rm's wording", () => {
    const result = harness().run(["--bogus"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("rm: unrecognized option '--bogus'");
  });

  test("getopt-style unambiguous abbreviations still resolve", () => {
    const target = file("f.txt");
    expect(harness().run(["--rec", target]).code).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  test("--help exits 0 and --version exits 0", () => {
    expect(harness().run(["--help"]).code).toBe(0);
    expect(harness().run(["--help"]).stdout).toContain("Usage: rm");
    expect(harness().run(["--version"]).code).toBe(0);
  });
});

describe("rmdir grammar", () => {
  const rmdir = (argv: string[], ask?: (q: string) => boolean) => harness().run(argv, { rmdir: true, ask });

  test("an empty directory is captured", () => {
    const dir = sandbox.dir("empty");
    expect(rmdir([dir]).code).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  test("a non-empty directory fails, and --ignore-fail-on-non-empty makes it succeed", () => {
    const dir = sandbox.dir("full");
    sandbox.file("full/x", "x");
    const failed = rmdir([dir]);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toBe(`rmdir: failed to remove '${dir}': Directory not empty\n`);
    expect(rmdir(["--ignore-fail-on-non-empty", dir]).code).toBe(0);
    expect(existsSync(dir)).toBe(true);
  });

  test("a missing path and a plain file have rmdir's own wording", () => {
    const missing = join(sandbox.root, "nope");
    const missingResult = rmdir([missing]);
    expect(missingResult.code).toBe(1);
    expect(missingResult.stderr).toBe(`rmdir: failed to remove '${missing}': No such file or directory\n`);

    const plain = file("plain.txt");
    const fileResult = rmdir([plain]);
    expect(fileResult.code).toBe(1);
    expect(fileResult.stderr).toBe(`rmdir: failed to remove '${plain}': Not a directory\n`);
  });

  test("-v prints to stdout with rmdir's prefix", () => {
    const dir = sandbox.dir("empty");
    const result = rmdir(["-v", dir]);
    expect(result.stdout).toBe(`rmdir: removing directory, '${dir}'\n`);
  });

  test("no operands is `missing operand`", () => {
    const result = rmdir([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("rmdir: missing operand");
  });

  test("-p is refused: it removes ancestors, each a delete of its own", () => {
    const dir = sandbox.dir("a/b");
    const result = rmdir(["-p", dir]);
    expect(result.code).toBe(2);
    expect(result.refused).toBe(1);
    expect(existsSync(dir)).toBe(true);
  });

  test("rm-only options are invalid in rmdir grammar", () => {
    const result = rmdir(["-r", sandbox.dir("d")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("invalid option -- 'r'");
  });
});

describe("capture refusals (§11.7)", () => {
  test("a refused capture refuses the DELETE — exit 2, path untouched", () => {
    const target = file("big.bin", "0123456789");
    const store = new TrashStore({
      roots: { root: spool },
      env: testEnv(sandbox),
      config: { capture: { maxEntryBytes: 4 } },
    });
    const out: string[] = [];
    const err: string[] = [];
    const result = runGuard({
      argv: ["-f", target],
      cwd: sandbox.root,
      io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) },
      store,
    });
    expect(result.code).toBe(2);
    expect(result.refused).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("capture refused");
    expect(err.join("")).toContain("was NOT deleted");
    // The load-bearing assertion: the path is still there.
    expect(existsSync(target)).toBe(true);
  });

  test("--allow-uncaptured is the explicit override, and only then does the delete happen", () => {
    const target = file("big.bin", "0123456789");
    const store = new TrashStore({
      roots: { root: spool },
      env: testEnv(sandbox),
      config: { capture: { maxEntryBytes: 4 } },
    });
    const result = runGuard({
      argv: ["-f", target],
      cwd: sandbox.root,
      io: { stdout: () => {}, stderr: () => {} },
      store,
      allowUncaptured: true,
    });
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  test("rm -f does NOT mean --allow-uncaptured", () => {
    // The distinction the whole capture policy rests on: `-f` is rm's, and it
    // must never be read as consent to delete without a capture.
    const target = file("big.bin", "0123456789");
    const store = new TrashStore({
      roots: { root: spool },
      env: testEnv(sandbox),
      config: { capture: { maxEntryBytes: 4 } },
    });
    const result = runGuard({
      argv: ["-rf", target],
      cwd: sandbox.root,
      io: { stdout: () => {}, stderr: () => {} },
      store,
    });
    expect(result.code).toBe(2);
    expect(existsSync(target)).toBe(true);
  });

  test("a protected path is refused even with --allow-uncaptured", () => {
    // `~/.hasna` is the protected class itself (§11.3), and that refusal is not
    // overridable: --allow-uncaptured waives the CAPTURE, never the protection.
    sandbox.dir("home");
    const protectedRoot = sandbox.dir("home/.hasna");
    sandbox.file("home/.hasna/precious", "keep");
    const result = harness().run(["-rf", protectedRoot], { allowUncaptured: true });
    expect(result.code).toBe(2);
    expect(outputSays(result, "protected")).toBe(true);
    expect(existsSync(protectedRoot)).toBe(true);
    expect(existsSync(join(protectedRoot, "precious"))).toBe(true);
  });

  test("a protected path is not handed the §11.7 remedy it cannot use", () => {
    // Exit-2 text is shown to the caller as the reason (§3), so it has to be an
    // instruction that WORKS. `--allow-uncaptured` does not lift a protected
    // path — the store refuses it again — so advertising it here sends the
    // caller into the same refusal. Probed at the CLI:
    //   trash guard -rf /tmp  ->  rc 2, "protected ... even with --allow-uncaptured"
    sandbox.dir("home");
    const protectedRoot = sandbox.dir("home/.hasna");
    sandbox.file("home/.hasna/precious", "keep");
    const result = harness().run(["-rf", protectedRoot]);
    expect(result.code).toBe(2);
    expect(existsSync(protectedRoot)).toBe(true);
    expect(outputSays(result, "no flag overrides it")).toBe(true);
    expect(outputSays(result, "--allow-uncaptured to delete it anyway")).toBe(false);
    // The exclusion hint is equally inapplicable: excludeGlobs is a capture
    // policy, and this path is refused before capture is reached.
    expect(outputSays(result, "excludeGlobs")).toBe(false);
  });
});

describe("the store is not bypassed", () => {
  test("an excluded path whose capture FAILS is deleted without a capture, and recorded", () => {
    // The exclude list is not "skip the capture" — a capturable path is still
    // captured. It is the fallback that keeps a full disk from self-locking the
    // machine (§6): when capture is impossible AND the path is in the excluded
    // class, the delete proceeds and the refusal is journaled.
    const h = harness({ maxEntryBytes: 4 });
    const target = sandbox.file("proj/node_modules/pkg/index.js", "0123456789");
    const result = h.run(["-rf", join(sandbox.root, "proj/node_modules")]);
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(false);
    expect(h.store.list()).toHaveLength(0);
    expect(h.store.status().refusals.total).toBeGreaterThan(0);
  });

  test("the deleted path is recoverable from the store", () => {
    const target = file("report.md", "important");
    const h = harness();
    expect(h.run(["-rf", target]).code).toBe(0);
    const entries = h.store.list();
    expect(entries).toHaveLength(1);
    const restored = h.store.restore(entries[0]!.id);
    expect(restored.restoredTo).toBe(target);
    expect(existsSync(target)).toBe(true);
  });
});
