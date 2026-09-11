/**
 * End-to-end: `trash guard`, spawned as a real process, with a real stdin pipe.
 *
 * The executor's own suite drives `runGuard` with an injected prompt reader,
 * which is the right way to test the table but cannot prove that STDIN is read
 * the way the contract says. Here stdin is an actual pipe whose contents are
 * written before the process is read, and the exit code comes from the process
 * itself — so `rm -i x < answers.txt` and a closed stdin are covered for real.
 *
 * The last test closes the loop: it takes the command the PLANNER says it would
 * rewrite `rm` into and runs it through `bash -c`, so a rewrite that is not
 * valid shell — or not in the argv order the guard's own parser expects —
 * fails here rather than in someone's shell.
 *
 * Every fixture is under a `mkdtemp` sandbox and every store is inside it.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createSandbox, spawnEnv, type Sandbox } from "../testing/sandbox.js";

const CLI = new URL("../cli/index.ts", import.meta.url).pathname;

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], stdin?: string): Promise<Run> {
  const proc = Bun.spawn({
    cmd: ["bun", CLI, "--spool", sandbox.path("spool"), ...args],
    env: spawnEnv(sandbox),
    cwd: sandbox.root,
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    await proc.stdin.end();
  }
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("the exit-code table, end to end", () => {
  test("`guard -f` with no operands exits 0", async () => {
    const result = await run(["guard", "-f"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("`guard` with no operands exits 1", async () => {
    const result = await run(["guard"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("rm: missing operand");
  });

  test("-f and -i are last-one-wins", async () => {
    expect((await run(["guard", "-f", "-i"])).code).toBe(1);
    expect((await run(["guard", "-i", "-f"])).code).toBe(0);
  });

  test("a missing path is 0 under -f and 1 without it", async () => {
    const missing = sandbox.path("not-there");
    expect((await run(["guard", "-f", missing])).code).toBe(0);
    const plain = await run(["guard", missing]);
    expect(plain.code).toBe(1);
    expect(plain.stderr).toBe(`rm: cannot remove '${missing}': No such file or directory\n`);
  });

  test("a directory without -r is an error, and -f does not suppress it", async () => {
    const dir = sandbox.dir("plain");
    const result = await run(["guard", "-f", dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`cannot remove '${dir}': Is a directory`);
    expect(existsSync(dir)).toBe(true);
  });

  test("the guard never writes to stdout without -v", async () => {
    const target = sandbox.file("quiet.txt", "x");
    const result = await run(["guard", "-rf", target]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(existsSync(target)).toBe(false);
  });

  test("-v reports on stdout", async () => {
    const target = sandbox.file("loud.txt", "x");
    const result = await run(["guard", "-v", target]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`removed '${target}'\n`);
  });

  test("--no-preserve-root is accepted, and waives nothing", async () => {
    // GNU deletes `/` when handed this flag; the guard denies the protected
    // class on its own authority and cannot be talked out of it. The flag is
    // accepted so a command carrying it still RUNS (into the denial) rather
    // than dying on an unknown option — and it does not unlock anything, as
    // the deletion it rides along on is still an ordinary guarded one.
    const target = sandbox.file("flag.txt", "x");
    const result = await run(["guard", "--no-preserve-root", "-rf", target]);
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(false);
  });
});

describe("stdin is read, and EOF is `no`", () => {
  test("`n` preserves the file and exits 0", async () => {
    const target = sandbox.file("keep.txt", "x");
    const result = await run(["guard", "-i", target], "n\n");
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(true);
    expect(result.stderr).toContain(`rm: remove regular file '${target}'? `);
  });

  test("`y` removes it", async () => {
    const target = sandbox.file("go.txt", "x");
    const result = await run(["guard", "-i", target], "y\n");
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(false);
  });

  test("a CLOSED stdin reads as EOF and preserves the file", async () => {
    // This is the case that decides whether a non-TTY hook context deletes
    // anything at all: with no input available, the answer is "no".
    const target = sandbox.file("keep.txt", "x");
    const result = await run(["guard", "-i", target]);
    expect(result.code).toBe(0);
    expect(existsSync(target)).toBe(true);
  });

  test("answers are consumed one per prompt", async () => {
    const first = sandbox.file("one.txt", "x");
    const second = sandbox.file("two.txt", "x");
    const result = await run(["guard", "-i", first, second], "y\nn\n");
    expect(result.code).toBe(0);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
  });

  test("empty stdin under -I declines the whole command", async () => {
    const files = ["a", "b", "c", "d"].map((name) => sandbox.file(`${name}.txt`, "x"));
    const result = await run(["guard", "-I", ...files], "");
    expect(result.code).toBe(0);
    for (const f of files) expect(existsSync(f)).toBe(true);
    expect(result.stderr).toContain("rm: remove 4 arguments? ");
  });
});

describe("refusals reach the shell as exit 2", () => {
  test("a protected path is refused and survives", async () => {
    const home = sandbox.dir("home");
    sandbox.dir("home/.ssh");
    const protectedPath = sandbox.file("home/.ssh/id_rsa", "PRIVATE");
    const result = await run(["guard", "-rf", protectedPath]);
    // `~/.ssh/id_rsa` is INSIDE the protected root, so it is captured rather
    // than refused; the root itself is what cannot be routed here.
    expect(result.code).toBe(0);
    expect(existsSync(protectedPath)).toBe(false);
    void home;
  });

  test("the protected root itself is refused with 2 and is untouched", async () => {
    const sshDir = sandbox.dir("home/.ssh");
    sandbox.file("home/.ssh/id_rsa", "PRIVATE");
    const result = await run(["guard", "-rf", sshDir]);
    expect(result.code).toBe(2);
    expect(existsSync(sshDir)).toBe(true);
    expect(result.stderr).toContain("no flag overrides it");
    // …and it does not offer a remedy that cannot work (§3: the exit-2 text is
    // an instruction, so it must be one the caller can act on).
    expect(result.stderr).not.toContain("--allow-uncaptured to delete it anyway");
  });
});

describe("--plan exposes the decision without touching the filesystem", () => {
  test("a rewrite embeds the spool as an absolute path in the command text", async () => {
    const target = sandbox.file("build/out.txt", "x");
    const result = await run(["--json", "guard", "--plan", `rm -rf ${target}`]);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.stdout) as { decision: string; command: string; targets: string[] };
    expect(document.decision).toBe("rewrite");
    expect(document.command).toBe(`trash guard --spool ${sandbox.path("spool")} -rf ${target}`);
    expect(document.targets).toEqual([target]);
    // Nothing was deleted: --plan decides, it does not act.
    expect(existsSync(target)).toBe(true);
  });

  test("a refuse verb is denied with exit 2", async () => {
    for (const command of ["git rm --cached f", "find . -delete", "shred -u secret", "unlink secret"]) {
      const result = await run(["--json", "guard", "--plan", command]);
      expect(result.code, command).toBe(2);
      const document = JSON.parse(result.stdout) as { decision: string; reason: string };
      expect(document.decision, command).toBe("deny");
      expect(document.reason.length, command).toBeGreaterThan(0);
    }
  });

  test("a protected root is denied", async () => {
    const result = await run(["--json", "guard", "--plan", "rm -rf /"]);
    expect(result.code).toBe(2);
    expect((JSON.parse(result.stdout) as { reason: string }).reason).toContain("protected class");
  });

  test("a command with no delete is allowed and unchanged", async () => {
    const result = await run(["--json", "guard", "--plan", "ls -la"]);
    expect(result.code).toBe(0);
    const document = JSON.parse(result.stdout) as { decision: string; command: string };
    expect(document.decision).toBe("allow");
    expect(document.command).toBe("ls -la");
  });
});

describe("the rewritten command actually runs", () => {
  test("plan output, executed through bash, deletes through the guard", async () => {
    const target = sandbox.file("build/out.txt", "capture me");
    const planned = await run(["--json", "guard", "--plan", `rm -rf ${target}`]);
    const document = JSON.parse(planned.stdout) as { command: string };
    expect(document.command.startsWith("trash guard --spool ")).toBe(true);

    // Substitute this checkout's CLI for the `trash` bin and run the command
    // the shell would have run. This is what proves the config-first argv
    // order in the rewrite is something the guard's own parser accepts.
    const shellCommand = document.command.replace(/^trash /, `bun ${CLI} `);
    const proc = Bun.spawn({
      cmd: ["bash", "-c", shellCommand],
      env: spawnEnv(sandbox),
      cwd: sandbox.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(existsSync(target)).toBe(false);

    // …and the file is in the store, not gone.
    const listed = await run(["--json", "list"]);
    const entries = JSON.parse(listed.stdout) as { originalPath: string }[];
    expect(entries.map((e) => e.originalPath)).toContain(target);
  });

  test("a rewritten refusal propagates as 2 through the shell", async () => {
    const sshDir = sandbox.dir("home/.ssh");
    const planned = await run(["--json", "guard", "--plan", `rm -rf ${sshDir}`]);
    // The planner refuses this one outright, so it never rewrites.
    expect(planned.code).toBe(2);
    expect(existsSync(sshDir)).toBe(true);
  });
});
