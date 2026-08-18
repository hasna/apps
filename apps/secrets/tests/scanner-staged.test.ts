import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanStagedExposures, stagedScanExitCode } from "../src/scanner.js";
import { hermeticGit, hermeticGitEnv } from "./setup/hermetic-git.js";

const rootDir = join(import.meta.dir, "..");

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-staged-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// Synthetic sentinels, assembled at runtime so no credential-shaped literal
// ever lives in this file — the same convention as tests/scanner.test.ts. Each
// class under test gets a DISTINCT detector, so a partial fix that recovers one
// class and silently drops another cannot pass by hitting a total count.
function coveredExtensionToken(): string {
  return ["sk", "proj", "stagedcoveredabcdefghijklmnop"].join("-");
}

function uncoveredExtensionToken(): string {
  return ["npm", "stageduncoveredabcdefghijklmnop"].join("_");
}

function binaryToken(): string {
  return ["AK", "IA", "STAGEDBINARYSENTINEL"].join("");
}

function renameToken(): string {
  return ["gh", "p", "_", "stagedrenameabcdefghijklmnop"].join("");
}

function gitAvailable(): boolean {
  return spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;
}

function git(args: string[], cwd = testDir): void {
  hermeticGit(args, cwd);
}

function initRepo(): void {
  git(["init"]);
  git(["config", "user.name", "Hasna Secrets Test"]);
  git(["config", "user.email", "secrets-test@example.invalid"]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

/**
 * A REAL PNG — correct signature, correct chunk CRCs — carrying the sentinel in
 * a tEXt chunk, which is exactly how metadata tooling leaks credentials into
 * image assets. Git emits no content at all for this file in any diff, so it is
 * unreachable by every diff-based gate no matter how the pathspec is written.
 */
function pngWithTextChunk(comment: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
    pngChunk("tEXt", Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.from(comment, "latin1")])),
    pngChunk("IDAT", Buffer.from([0x08, 0xd7, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function detectorsFor(result: ReturnType<typeof scanStagedExposures>, path: string): string[] {
  return result.findings.filter((finding) => finding.path === path).map((finding) => finding.detector);
}

describe("staged exposure scanner", () => {
  it("finds credentials in covered, uncovered and BINARY staged blobs alike", () => {
    if (!gitAvailable()) return;

    const covered = coveredExtensionToken();
    const uncovered = uncoveredExtensionToken();
    const binary = binaryToken();

    initRepo();
    mkdirSync(join(testDir, "src"), { recursive: true });
    mkdirSync(join(testDir, "assets"), { recursive: true });
    writeFileSync(join(testDir, "src/app.ts"), `export const a = "${covered}";\n`);
    writeFileSync(join(testDir, "src/Widget.tsx"), `export const W = () => <b>${uncovered}</b>;\n`);
    writeFileSync(join(testDir, "assets/logo.png"), pngWithTextChunk(binary));
    git(["add", "-A"]);

    const result = scanStagedExposures({ root: testDir });
    const serialized = JSON.stringify(result);

    // Asserted PER CLASS. A fix that recovers .tsx and still misses the binary
    // fails here, which a total-count assertion would have let through.
    expect(detectorsFor(result, "src/app.ts")).toContain("openai_api_key");
    expect(detectorsFor(result, "src/Widget.tsx")).toContain("package_registry_token");
    expect(detectorsFor(result, "assets/logo.png")).toContain("aws_access_key_id");

    // The binary finding is labelled, and its column is a byte offset into the
    // blob rather than a column on a line that does not exist.
    const png = result.findings.find((finding) => finding.path === "assets/logo.png")!;
    expect(png.binary).toBe(true);
    expect(png.line).toBe(1);
    expect(png.column).toBeGreaterThan(8);

    expect(result.source).toBe("staged");
    expect(result.redacted).toBe(true);
    expect(result.stats.filesScanned).toBe(3);
    expect(stagedScanExitCode(result)).toBe(1);

    // No sentinel value survives into the output, in any class.
    expect(serialized).not.toContain(covered);
    expect(serialized).not.toContain(uncovered);
    expect(serialized).not.toContain(binary);
    expect(png.preview).toContain("***REDACTED***");
  });

  it("catches a rename-with-edit, which --diff-filter=ACM cannot see at any extension", () => {
    if (!gitAvailable()) return;

    const value = renameToken();
    // Enough shared body that appending one line keeps similarity above git's
    // rename threshold. With a short file the same edit scores as add+delete
    // and the R case silently stops being exercised at all.
    const body = Array.from({ length: 30 }, (_, index) => `padding line ${index}`).join("\n");

    initRepo();
    writeFileSync(join(testDir, "old.ts"), `${body}\n`);
    git(["add", "-A"]);
    git(["commit", "-m", "base"]);
    git(["mv", "old.ts", "new.ts"]);
    writeFileSync(join(testDir, "new.ts"), `${body}\nconst k = "${value}";\n`);
    git(["add", "-A"]);

    const gitDiff = (args: string[]): string =>
      spawnSync("git", ["diff", "--cached", ...args], {
        cwd: testDir,
        encoding: "utf8",
        env: hermeticGitEnv(),
      }).stdout;

    // The premise, asserted rather than assumed: git records this as a RENAME,
    // and an ACM-filtered diff is therefore empty even though the staged blob
    // gained a credential. If git's rename heuristics ever change, this fails
    // here instead of quietly testing an add.
    expect(gitDiff(["--name-status"]).trim()).toStartWith("R");
    expect(gitDiff(["--diff-filter=ACM"]).trim()).toBe("");

    const result = scanStagedExposures({ root: testDir });
    expect(detectorsFor(result, "new.ts")).toContain("github_token");
    expect(stagedScanExitCode(result)).toBe(1);
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it("reads the STAGED blob, not the working-tree file", () => {
    if (!gitAvailable()) return;

    const value = coveredExtensionToken();
    initRepo();
    writeFileSync(join(testDir, "app.ts"), `export const a = "${value}";\n`);
    git(["add", "app.ts"]);
    // The working tree is cleaned up AFTER staging. A scanner that reads the
    // worktree sees nothing and waves the commit through; the commit still
    // carries the credential.
    writeFileSync(join(testDir, "app.ts"), "export const a = \"clean\";\n");

    const result = scanStagedExposures({ root: testDir });
    expect(result.findingCount).toBe(1);
    expect(result.findings[0].path).toBe("app.ts");
    expect(stagedScanExitCode(result)).toBe(1);
  });

  it("ignores a working-tree-only credential that is not staged", () => {
    if (!gitAvailable()) return;

    initRepo();
    writeFileSync(join(testDir, "app.ts"), "export const a = \"clean\";\n");
    git(["add", "app.ts"]);
    // Unstaged, therefore not part of this commit, therefore not this gate's call.
    writeFileSync(join(testDir, "app.ts"), `export const a = "${coveredExtensionToken()}";\n`);

    const result = scanStagedExposures({ root: testDir });
    expect(result.findingCount).toBe(0);
    expect(stagedScanExitCode(result)).toBe(0);
  });

  it("exits 0 with no findings when nothing is staged", () => {
    if (!gitAvailable()) return;

    initRepo();
    writeFileSync(join(testDir, "app.ts"), "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-m", "base"]);

    const result = scanStagedExposures({ root: testDir });
    expect(result.findingCount).toBe(0);
    expect(result.stats.filesScanned).toBe(0);
    expect(result.stats.skipped).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(stagedScanExitCode(result)).toBe(0);
  });

  it("handles a staged deletion without inventing a finding or an error", () => {
    if (!gitAvailable()) return;

    initRepo();
    writeFileSync(join(testDir, "gone.ts"), `export const a = "${coveredExtensionToken()}";\n`);
    writeFileSync(join(testDir, "kept.ts"), "export const b = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-m", "base"]);
    git(["rm", "gone.ts"]);

    // A deletion has no staged blob. Removing the file that held a credential
    // must not be reported as introducing one.
    const result = scanStagedExposures({ root: testDir });
    expect(result.findingCount).toBe(0);
    expect(result.stats.errors).toEqual([]);
    expect(result.stats.skipped).toEqual([]);
    expect(stagedScanExitCode(result)).toBe(0);
  });

  it("REPORTS an oversized skip and refuses to call the scan clean", () => {
    if (!gitAvailable()) return;

    initRepo();
    writeFileSync(join(testDir, "big.ts"), `export const a = "${coveredExtensionToken()}";\n`);
    git(["add", "-A"]);

    const result = scanStagedExposures({ root: testDir, maxFileBytes: 8 });

    expect(result.findingCount).toBe(0);
    expect(result.stats.filesScanned).toBe(0);
    expect(result.stats.skipped).toHaveLength(1);
    expect(result.stats.skipped![0].path).toBe("big.ts");
    expect(result.stats.skipped![0].reason).toBe("max_file_bytes");
    // Zero findings, but NOT exit 0 — the gate did not read the blob, so it
    // cannot say the commit is clean. This is the whole defect class, in a box.
    expect(stagedScanExitCode(result)).toBe(2);
  });

  it("finds a credential in a UTF-16LE blob, which git also calls binary", () => {
    if (!gitAvailable()) return;

    const value = coveredExtensionToken();
    initRepo();
    // A COVERED extension carrying ordinary config text. Git reports it as
    // binary purely because of the encoding, so every diff variant emits
    // "Binary files differ" and nothing else. Byte-run extraction cannot save
    // it either: each ASCII run here is one byte wide.
    writeFileSync(
      join(testDir, "settings.json"),
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(`{"token": "${value}"}\n`, "utf16le"),
      ]),
    );
    git(["add", "-A"]);

    const isBinaryToGit = spawnSync("git", ["diff", "--cached", "--numstat"], {
      cwd: testDir,
      encoding: "utf8",
      env: hermeticGitEnv(),
    }).stdout;
    // git reports "-\t-" for a file it considers binary.
    expect(isBinaryToGit).toStartWith("-\t-");

    const result = scanStagedExposures({ root: testDir });
    expect(detectorsFor(result, "settings.json")).toContain("openai_api_key");
    expect(stagedScanExitCode(result)).toBe(1);
    expect(JSON.stringify(result)).not.toContain(value);
  });

  it("scans the WHOLE staged blob, not just the lines near an edit", () => {
    if (!gitAvailable()) return;

    const value = binaryToken();
    initRepo();
    // The credential is committed first and sits far from any later edit, so it
    // falls outside every diff's context window forever after. A diff-based
    // gate never sees it again on any subsequent commit; a blob scan always does.
    const padding = Array.from({ length: 200 }, (_, index) => `filler ${index}`).join("\n");
    writeFileSync(join(testDir, "config.ts"), `const key = "${value}";\n${padding}\n`);
    git(["add", "-A"]);
    git(["commit", "-m", "base"]);

    writeFileSync(join(testDir, "config.ts"), `const key = "${value}";\n${padding}\nconst added = 1;\n`);
    git(["add", "-A"]);

    const hunks = spawnSync("git", ["diff", "--cached", "-U3"], {
      cwd: testDir,
      encoding: "utf8",
      env: hermeticGitEnv(),
    }).stdout;
    // Premise: the credential is genuinely absent from the rendered diff.
    expect(hunks).not.toContain(value);

    const result = scanStagedExposures({ root: testDir });
    expect(detectorsFor(result, "config.ts")).toContain("aws_access_key_id");
    expect(stagedScanExitCode(result)).toBe(1);
  });

  it("scans the WHOLE staged set when invoked from a subdirectory", () => {
    if (!gitAvailable()) return;

    const value = coveredExtensionToken();
    initRepo();
    mkdirSync(join(testDir, "sub"), { recursive: true });
    writeFileSync(join(testDir, "root-secret.ts"), `const k = "${value}";\n`);
    writeFileSync(join(testDir, "sub/local.ts"), "export const clean = 1;\n");
    git(["add", "-A"]);

    // The control being replaced is repo-wide from any cwd: `git diff --cached`
    // ignores cwd for enumeration. A gate that silently narrows to the caller's
    // subdirectory is a COVERAGE REGRESSION — `git commit` from that same
    // subdirectory still commits every staged blob in the repo.
    const staged = spawnSync("git", ["diff", "--cached", "--name-only"], {
      cwd: join(testDir, "sub"),
      encoding: "utf8",
      env: hermeticGitEnv(),
    }).stdout.split("\n").filter(Boolean);
    expect(staged).toHaveLength(2);

    const toplevel = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: join(testDir, "sub"),
      encoding: "utf8",
      env: hermeticGitEnv(),
    }).stdout.trim();

    const result = scanStagedExposures({ root: join(testDir, "sub") });
    expect(result.stats.filesScanned).toBe(2);
    expect(detectorsFor(result, "root-secret.ts")).toContain("openai_api_key");
    expect(stagedScanExitCode(result)).toBe(1);
    // `root` reports what was actually scanned, so the output cannot imply a
    // narrower reading than the one performed.
    expect(result.root).toBe(toplevel);
  });

  it("still scopes to a subtree when --subtree is explicitly opted into", () => {
    if (!gitAvailable()) return;

    initRepo();
    mkdirSync(join(testDir, "sub"), { recursive: true });
    writeFileSync(join(testDir, "root-secret.ts"), `const k = "${coveredExtensionToken()}";\n`);
    writeFileSync(join(testDir, "sub/local.ts"), "export const clean = 1;\n");
    git(["add", "-A"]);

    const result = scanStagedExposures({ root: join(testDir, "sub"), subtree: true });
    expect(result.stats.filesScanned).toBe(1);
    expect(result.findingCount).toBe(0);
    expect(result.root).toBe(join(testDir, "sub"));
  });

  it("does not let a filename matching ^[0-3]: bypass the scan", () => {
    if (!gitAvailable()) return;

    const value = coveredExtensionToken();
    initRepo();
    // `0:foo` is a legal POSIX filename. Queried as `:0:foo`, git parses it as
    // "stage 0 of foo" — the WRONG object — so the real file's blob is never
    // read while a clean one is counted twice. An attacker needs only the
    // filename. The explicit `:0:<path>` form disambiguates it.
    writeFileSync(join(testDir, "foo"), "clean content here\n");
    writeFileSync(join(testDir, "0:foo"), `const k = "${value}";\n`);
    git(["add", "-A"]);

    const result = scanStagedExposures({ root: testDir });

    expect(result.stats.filesScanned).toBe(2);
    expect(detectorsFor(result, "0:foo")).toContain("openai_api_key");
    expect(stagedScanExitCode(result)).toBe(1);
    // The two staged paths must resolve to two DISTINCT blobs; the defect
    // attributed one blob to both names.
    expect(new Set(result.findings.map((finding) => finding.path)).size).toBe(1);
  });

  it("exits 2 rather than 0 when the path is not a git workspace", () => {
    const result = scanStagedExposures({ root: testDir });
    expect(result.findingCount).toBe(0);
    expect(result.stats.errors[0]).toContain("Not a git workspace");
    expect(stagedScanExitCode(result)).toBe(2);
  });

  it("blocks a real commit through the CLI: exit 1 with findings, 0 when clean", () => {
    if (!gitAvailable()) return;

    initRepo();
    writeFileSync(join(testDir, "clean.ts"), "export const a = 1;\n");
    git(["add", "-A"]);

    const run = (...extra: string[]): { code: number; stdout: string } => {
      const proc = Bun.spawnSync({
        cmd: ["bun", "src/index.ts", "scan", "staged", testDir, ...extra],
        cwd: rootDir,
        env: { ...hermeticGitEnv(), NO_COLOR: "1" } as Record<string, string>,
      });
      return { code: proc.exitCode, stdout: proc.stdout.toString() };
    };

    // DIRECTION 1 — scanned everything, found nothing.
    const clean = run();
    expect(clean.code).toBe(0);
    expect(JSON.parse(clean.stdout).findingCount).toBe(0);

    writeFileSync(join(testDir, "dirty.tsx"), `export const W = "${uncoveredExtensionToken()}";\n`);
    git(["add", "-A"]);

    // DIRECTION 2 — found something.
    const dirty = run();
    expect(dirty.code).toBe(1);
    const parsed = JSON.parse(dirty.stdout);
    expect(parsed.findingCount).toBeGreaterThan(0);
    expect(parsed.findings.some((finding: { path: string }) => finding.path === "dirty.tsx")).toBe(true);

    // The credential value never reaches stdout, on either formatter. The old
    // shell gate ended in a bare grep, whose stdout IS the matched line.
    expect(dirty.stdout).not.toContain(uncoveredExtensionToken());
    const pretty = run("--pretty");
    expect(pretty.code).toBe(1);
    expect(pretty.stdout).not.toContain(uncoveredExtensionToken());
    expect(pretty.stdout).toContain("***REDACTED***");
    expect(pretty.stdout).toContain("dirty.tsx");

    // DIRECTION 3 — could not scan. Distinct from both, so a caller can tell
    // "clean" from "I never looked".
    const incomplete = run("--max-bytes", "4");
    expect(incomplete.code).toBe(2);
    const skipped = JSON.parse(incomplete.stdout);
    expect(skipped.findingCount).toBe(0);
    expect(skipped.stats.skipped.length).toBeGreaterThan(0);
  });
});
