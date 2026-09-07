import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

/**
 * The regression `src/lib/stdout.test.ts` cannot prove: that the *shipped CLI*
 * does not lose its tail when stdout is a pipe.
 *
 * Measured on station01, Bun 1.3.14, against the published `@hasna/domains`
 * 0.0.36 binary and a 1,040-row portfolio:
 *
 *     domains domain list --all --json > file       ->  929621 bytes, rc=0
 *     domains domain list --all --json | wc -c      ->   65536 bytes, rc=0
 *
 * 7% of the document, delivered at exit code 0 with empty stderr. Nothing
 * distinguishes it from success; strict `JSON.parse` throwing is the only
 * reason it was noticed rather than published as a 7% answer.
 *
 * ── Why this test builds a bundle instead of running `src/cli/index.ts` ──
 *
 * IT HAS TO. Running the CLI from source does NOT reproduce the defect, and a
 * test written the convenient way passes against the bug. Measured in this
 * worktree, same command, same store, same machine, same minute:
 *
 *     bun run src/cli/index.ts domain list --all --json | …  ->  929621  COMPLETE
 *     bun .pipe-e2e/index.js   domain list --all --json | …  ->   65536  TRUNCATED
 *
 * The difference is `ink`. `src/cli/index.ts` reaches the TUI only through
 * `await import("./commands/interactive.js")`, gated behind the `interactive`
 * optional group, so from source ink is never loaded. `bun build` inlines that
 * dynamically-imported module into the single-file bundle while `ink` stays
 * `--external`, which turns it into a STATIC top-level `import … from "ink"` in
 * the output — hoisted and evaluated on every invocation, whatever the command.
 *
 * Loading ink puts fd 1 into non-blocking mode. Measured by reading
 * `/proc/self/fdinfo/1` inside a real run of the published binary:
 *
 *     preload-start fd1  flags: 01     (O_WRONLY)
 *     at-exit       fd1  flags: 04001  (O_WRONLY | O_NONBLOCK)
 *
 * and on a non-blocking fd Bun's `console.log` performs one `write(2)` and
 * discards whatever the pipe would not take. It is not an exit race: patching a
 * 300 ms delay in after the write leaves the output truncated exactly the same.
 *
 * So the truncation exists only in the artifact users install, and only a test
 * that builds that artifact can see it.
 *
 * The cut is also NOT a fixed constant. A run that read the fd flags first
 * delivered 81920 bytes where the plain run delivered 65536 — it is whatever
 * one write to that pipe happened to accept, which is why an assertion must
 * compare against the whole document rather than against 65536.
 */
describe("domains --json over a pipe", () => {
  // Past four pipe buffers, so a truncation cannot hide inside one.
  const DOMAIN_ROWS = 800;
  const PIPE_TRIALS = 3;
  const PIPE_BUFFER_BYTES = 65536;
  // Each measurement cold-starts the bundled CLI in a subprocess.
  const SPAWN_TIMEOUT_MS = 180_000;
  const REPO_ROOT = join(import.meta.dir, "..", "..");

  let fixture: { dir: string; bigDb: string; smallDb: string; bundle: string };

  /**
   * Build the CLI exactly as `bun run build` does.
   *
   * The `--external` set is copied from package.json's build script and is
   * load-bearing rather than incidental: it is `--external ink` that turns the
   * lazily-imported TUI into an eagerly-evaluated top-level import, which is
   * the condition being regressed against. Dropping it here would inline ink
   * into the bundle and could change whether the defect reproduces at all.
   *
   * The bundle is emitted INSIDE the repo so that Bun resolves those externals
   * from the repo's own node_modules; a bundle written to /tmp dies at startup
   * with "Cannot find package 'ink'".
   */
  function buildBundle(outDir: string): string {
    const build = Bun.spawnSync({
      cmd: [
        "bun", "build", "src/cli/index.ts",
        "--outdir", outDir,
        "--target", "bun",
        "--external", "ink",
        "--external", "react",
        "--external", "chalk",
        "--external", "ink-text-input",
        "--external", "@modelcontextprotocol/sdk",
        "--external", "@hasna/contacts",
        "--external", "pg",
      ],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ step: "build", code: build.exitCode, stderr: build.stderr.toString().slice(0, 800) })
      .toEqual({ step: "build", code: 0, stderr: "" });
    return join(outDir, "index.js");
  }

  /**
   * A store the CLI itself created and migrated, so the fixture cannot drift
   * from the real schema, then filled directly for speed.
   */
  function seedStore(dbPath: string, rows: number, bundle: string): void {
    const boot = Bun.spawnSync({
      cmd: ["bun", bundle, "domain", "list", "--json"],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(dbPath),
    });
    // The boot is an explicit local-mode run (DOMAINS_DB_PATH), so stderr
    // carries the required one-line "LOCAL mode" notice and nothing else.
    const bootStderr = boot.stderr.toString();
    const noticeOnly = bootStderr
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .every((line) => line.includes("LOCAL mode"));
    expect({ step: "boot", code: boot.exitCode, stderr: bootStderr, noticeOnly })
      .toEqual({ step: "boot", code: 0, stderr: bootStderr, noticeOnly: true });

    if (rows === 0) return;
    const db = new Database(dbPath);
    const insert = db.prepare(
      "INSERT INTO domains (id, name, registrar, status, expires_at, notes, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for (let i = 0; i < rows; i++) {
      const slug = `fixture-${String(i).padStart(4, "0")}`;
      insert.run(
        slug,
        `${slug}.example`,
        "fixture-registrar",
        "active",
        "2027-01-01",
        "n".repeat(300),
        JSON.stringify({ note: "v".repeat(100) }),
      );
    }
    db.exec("COMMIT");
    db.close();
  }

  function cliEnv(dbPath: string): Record<string, string | undefined> {
    return {
      ...process.env,
      DOMAINS_DB_PATH: dbPath,
      // Any API pointer flips the client onto the HTTP store, which would
      // measure the wrong process and write to the shared fleet store.
      HASNA_DOMAINS_API_URL: undefined,
      HASNA_DOMAINS_API_KEY: undefined,
      DOMAINS_API_URL: undefined,
      DOMAINS_API_KEY: undefined,
      // Colour differs between the file run and the pipe run by inherited TTY
      // state, which would defeat byte equality for a reason unrelated to this
      // defect.
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    };
  }

  /**
   * `bash`, explicitly, never `sh`.
   *
   * `/bin/sh` is dash on Debian and Ubuntu, and dash has no `set -o pipefail`:
   * it answers `set: Illegal option -o pipefail` at rc=2 and runs nothing, so a
   * pipe test that degraded to dash would measure nothing. `pipefail` is the
   * whole point — without it the pipeline reports `cat`'s status, so a producer
   * that died mid-document still reads as success, which is the exact class of
   * lie this file exists to catch.
   */
  function pipeline(script: string, dbPath: string) {
    return Bun.spawnSync({
      cmd: ["bash", "-c", `set -o pipefail; ${script}`],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(dbPath),
    });
  }

  const listJson = (bundle: string) => `bun ${JSON.stringify(bundle)} domain list --all --json`;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "domains-stdout-pipe-"));
    // Inside the repo, for external resolution; removed in afterAll.
    const bundleDir = join(REPO_ROOT, ".pipe-e2e-fixture");
    rmSync(bundleDir, { recursive: true, force: true });
    const bundle = buildBundle(bundleDir);
    const bigDb = join(dir, "big.db");
    const smallDb = join(dir, "small.db");
    seedStore(bigDb, DOMAIN_ROWS, bundle);
    seedStore(smallDb, 2, bundle);
    fixture = { dir, bigDb, smallDb, bundle };
  }, SPAWN_TIMEOUT_MS);

  afterAll(() => {
    if (!fixture) return;
    rmSync(fixture.dir, { recursive: true, force: true });
    rmSync(join(REPO_ROOT, ".pipe-e2e-fixture"), { recursive: true, force: true });
  });

  test("domain list --all --json delivers the same bytes through a pipe as to a file", () => {
    const { dir, bigDb, bundle } = fixture;
    const outFile = join(dir, "redirected.json");
    const redirected = pipeline(`${listJson(bundle)} > ${JSON.stringify(outFile)}`, bigDb);
    expect(redirected.exitCode).toBe(0);
    const expected = readFileSync(outFile);

    // Guard the guard. Below one pipe buffer every assertion here passes
    // vacuously, because the defect only manifests past the buffer. This is the
    // positive-control side: the input must be capable of producing the failure.
    expect(expected.byteLength).toBeGreaterThan(PIPE_BUFFER_BYTES * 4);

    for (let trial = 0; trial < PIPE_TRIALS; trial++) {
      const piped = pipeline(`${listJson(bundle)} | cat`, bigDb);
      // With pipefail this is the PRODUCER's status, not `cat`'s.
      expect(piped.exitCode).toBe(0);
      // Compare BYTES. `String.length` counts UTF-16 code units and the cut is
      // at a byte boundary, so on multi-byte content the two diverge in the
      // direction that hides truncation.
      expect({ trial, bytes: piped.stdout.byteLength }).toEqual({
        trial,
        bytes: expected.byteLength,
      });
      expect(Buffer.compare(Buffer.from(piped.stdout), expected)).toBe(0);
    }

    // Parse as well as size, so a *valid* short answer would still fail.
    const parsed = JSON.parse(expected.toString("utf8")) as { domains: unknown[]; count: number };
    expect(parsed.domains.length).toBe(DOMAIN_ROWS);
    expect(parsed.count).toBe(DOMAIN_ROWS);
  }, SPAWN_TIMEOUT_MS);

  test("a payload below one pipe buffer is still delivered whole and unchanged", () => {
    // The other side of the fixture. A writer that only handled the large case
    // — or that appended, dropped or reordered anything on a short write — would
    // be a worse defect than the one being fixed, and the large-payload test
    // above cannot see it.
    const { dir, smallDb, bundle } = fixture;
    const outFile = join(dir, "small.json");
    const redirected = pipeline(`${listJson(bundle)} > ${JSON.stringify(outFile)}`, smallDb);
    expect(redirected.exitCode).toBe(0);
    const expected = readFileSync(outFile);

    // Control on the control: this arm is only meaningful while it stays under
    // one buffer, so assert it does rather than assuming it.
    expect(expected.byteLength).toBeLessThan(PIPE_BUFFER_BYTES);
    expect(expected.byteLength).toBeGreaterThan(0);

    const piped = pipeline(`${listJson(bundle)} | cat`, smallDb);
    expect(piped.exitCode).toBe(0);
    expect(Buffer.compare(Buffer.from(piped.stdout), expected)).toBe(0);
    const parsed = JSON.parse(piped.stdout.toString()) as { count: number };
    expect(parsed.count).toBe(2);
  }, SPAWN_TIMEOUT_MS);

  test("a non-JSON surface, domain export --format csv, is not truncated either", () => {
    // `--json` is not the only affected surface, and this arm exists to keep
    // the fix from being read as JSON-specific. Measured against the unfixed
    // bundle on this same fixture:
    //
    //     domain list --all --json        822523 -> 65536   TRUNCATED
    //     domain export --format json     572803 -> 131072  TRUNCATED
    //     domain export --format csv      301772 -> 65536   TRUNCATED
    //     domain expiring --days 9999 -j  784003 -> 65536   TRUNCATED
    //     domain list --all --verbose     110499 -> 110499  intact
    //
    // The last row is why this arm uses `export` rather than `list --verbose`,
    // and the distinction is the whole mechanism: `list --verbose` prints one
    // small `console.log` per row, and no single write ever exceeds what the
    // pipe accepts, so it survives the bug and would pass here whether the fix
    // existed or not. `export` writes the entire portfolio in ONE call, which
    // is exactly the shape that loses its tail. An arm that cannot fail against
    // the unfixed build proves nothing, so it must be a single-write surface.
    //
    // Note also that `export --format json` lost its tail at 131072, two
    // buffers rather than one: the cut is whatever the reader had drained by
    // then, not a constant to assert against.
    const { dir, bigDb, bundle } = fixture;
    const csv = `bun ${JSON.stringify(bundle)} domain export --format csv`;
    const outFile = join(dir, "redirected.csv");
    const redirected = pipeline(`${csv} > ${JSON.stringify(outFile)}`, bigDb);
    expect(redirected.exitCode).toBe(0);
    const expected = readFileSync(outFile);
    // Positive control on the input: under one buffer this proves nothing.
    expect(expected.byteLength).toBeGreaterThan(PIPE_BUFFER_BYTES * 4);

    const piped = pipeline(`${csv} | cat`, bigDb);
    expect(piped.exitCode).toBe(0);
    expect(piped.stdout.byteLength).toBe(expected.byteLength);
    expect(Buffer.compare(Buffer.from(piped.stdout), expected)).toBe(0);
    // A CSV row per domain plus the header, so a short-but-valid-looking answer
    // still fails.
    expect(piped.stdout.toString().trimEnd().split("\n").length).toBe(DOMAIN_ROWS + 1);
  }, SPAWN_TIMEOUT_MS);

  test("ends cleanly when the reader closes the pipe, without an unhandled EPIPE", () => {
    // Deleting the EPIPE branch from the writer would regress silently:
    // writeSync throws, Bun prints an uncaught EPIPE and a stack, and
    // `domains domain list --all --json | head` — an ordinary shell pipeline —
    // becomes a crash.
    //
    // A closed reader makes a SHORT document the CORRECT outcome here, which is
    // the difference from the tests above. Both a clean stop and a deliberate
    // non-zero producer exit satisfy the contract, so the exit code is not
    // asserted; what is asserted is that it terminated, emitted no unhandled
    // failure, and still produced the start of the real document.
    const { bigDb, bundle } = fixture;
    const result = pipeline(`${listJson(bundle)} | head -1`, bigDb);
    expect(result.exitCode).not.toBeNull();
    const stderr = result.stderr.toString();
    expect(stderr).not.toContain("EPIPE");
    expect(stderr).not.toContain("ERR_STREAM_DESTROYED");
    // The JSON document is pretty-printed, so its first line is the opening
    // brace. Getting it proves the producer wrote before the reader left,
    // rather than dying at startup and passing by writing nothing.
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("{");
  }, SPAWN_TIMEOUT_MS);
});

/**
 * A writer module does nothing for a call site that bypasses it.
 *
 * In hasna/repos the identical defect was fixed by routing every `--json`
 * surface through a completing writer, and came straight back on a *new*
 * surface added later with a fresh `console.log(JSON.stringify(...))`. Care at
 * review time does not substitute for a check that fails, so reintroducing the
 * bypass is a red test here rather than a defect found later by whatever
 * consumed the truncated output.
 *
 * The ban covers plain text as well as JSON, because `domain list --verbose` is
 * an unbounded plain-text surface and overflows a pipe buffer exactly as
 * readily.
 *
 * ── Why the ban covers `process.stdout.write` too ──
 *
 * The first version of this guard banned `console.log` and `console.error` and
 * nothing else, because those were the 742 sites the fix had just converted.
 * THAT CALIBRATES THE GUARD TO THE LAST RECURRENCE RATHER THAN TO THE CLASS.
 * Eight `process.stdout.write` calls survived that conversion — seven progress
 * prefixes in `commands/domain.ts` and one in `commands/route53.ts` — and the
 * guard was green with all eight in place.
 *
 * They were harmless, and harmless is not the same as safe. Every one was a
 * short fixed string well under a pipe buffer, so none of them could truncate.
 * But `process.stdout.write` is the SAME unchecked-write shape as `console.log`
 * on a non-blocking fd 1: one `write(2)`, remainder discarded, rc=0. The next
 * unbounded payload written that way — a `--json` surface added by someone who
 * reached for the obvious API — reintroduces exactly the defect this file
 * exists to catch, with the guard still passing.
 *
 * `writeStdout` (no trailing newline) and `writeStdoutBytes` already existed for
 * precisely these call sites and were unused at all eight. `process.stderr.write`
 * is banned on the same reasoning even though it has no offenders today: fd 2 is
 * a pipe under `2>&1 |` or `2>file`, `printErrorLine` covers it, and a guard
 * written only against the descriptor that happened to fail is the same
 * calibration error one fd over.
 *
 * Other `process.stdout` properties — `columns`, `isTTY` — are reads, not
 * writes, and are deliberately not matched.
 */
describe("no CLI surface bypasses the completing writer", () => {
  const CLI_ROOT = import.meta.dir;
  const BYPASS = /\bconsole\.(log|error)\s*\(|\bprocess\.(stdout|stderr)\.write\s*\(/;

  function sourceFiles(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        sourceFiles(full, found);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  }

  /**
   * The offender list is an ABSENCE claim, and an absence claim is worth
   * exactly as much as the probe behind it. A typo in `BYPASS` — or a later
   * edit that narrows it — produces an empty offender list that is
   * indistinguishable from a clean tree. So assert the pattern can fire on each
   * banned form, and stay silent on the sanctioned replacements, before
   * believing the zero it returns below.
   */
  test("the bypass pattern matches every banned form and no sanctioned one", () => {
    const mustMatch = [
      'console.log("x")',
      "console.log()",
      'console.error("x")',
      "console.error (x)",
      'process.stdout.write("x")',
      "process.stdout.write (x)",
      'process.stderr.write("x")',
      '  if (x) process.stdout.write(`  Status: ${s}\\r`);',
    ];
    const mustNotMatch = [
      'printLine("x")',
      'printErrorLine("x")',
      "printJson(value)",
      'writeStdout("x")',
      "writeStdoutBytes(bytes)",
      "const width = process.stdout.columns ?? 80;",
      "if (process.stdout.isTTY) {",
    ];
    expect(mustMatch.filter((line) => !BYPASS.test(line))).toEqual([]);
    expect(mustNotMatch.filter((line) => BYPASS.test(line))).toEqual([]);
  });

  test("no console.log, console.error or process.std{out,err}.write remains anywhere under src/cli/", () => {
    const files = sourceFiles(CLI_ROOT);
    // Guard the guard: if the walk found nothing, an empty offender list would
    // pass vacuously.
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (BYPASS.test(line)) offenders.push(`${relative(CLI_ROOT, file)}:${i + 1}`);
        });
    }
    // Named in the failure so the fix is obvious: replace with printLine /
    // printErrorLine / printJson / writeStdout / writeStdoutBytes from
    // src/lib/stdout.ts.
    expect(offenders).toEqual([]);
  });
});
