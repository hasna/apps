import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  STAGE_A_CANDIDATE_IDENTITY_VERSION,
  canonicalCandidateInput,
  canonicalSortedUntrackedPaths,
  decodeCanonicalCandidateInput,
  type CanonicalUntrackedIdentity,
} from "../scripts/stage-a-candidate-identity.js";

const REPO_ROOT = join(import.meta.dir, "..");
const CANDIDATE_SCRIPT = join(REPO_ROOT, "scripts", "candidate-digest.sh");

function run(command: string, args: string[], cwd: string, timeout = 5_000) {
  return spawnSync(command, args, {
    cwd,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C",
      BUN_EXECUTABLE: process.execPath,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
}

function fixture(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), "todos-candidate-v5-"));
  expect(run("git", ["init", "-q"], root).status).toBe(0);
  writeFileSync(join(root, "tracked.txt"), "tracked\n");
  expect(run("git", ["add", "tracked.txt"], root).status).toBe(0);
  expect(run("git", [
    "-c", "user.name=Stage A Test",
    "-c", "user.email=stage-a-test.invalid",
    "commit", "-q", "-m", "base",
  ], root).status).toBe(0);
  const base = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
  expect(base).toMatch(/^[a-f0-9]{40}$/);
  return { root, base };
}

function digest(root: string, base: string, timeout = 5_000) {
  return run("bash", [CANDIDATE_SCRIPT, base, "candidate"], root, timeout);
}

describe("Stage A V5 canonical candidate identity", () => {
  test("untracked mode is part of the canonical identity", () => {
    const { root, base } = fixture();
    try {
      const path = join(root, "mode-sensitive.txt");
      writeFileSync(path, "same bytes\n");
      chmodSync(path, 0o644);
      const first = digest(root, base);
      expect(first.status, first.stderr).toBe(0);
      chmodSync(path, 0o755);
      const second = digest(root, base);
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout.trim()).not.toBe(first.stdout.trim());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("symlinked and multiply-linked untracked inputs are rejected", () => {
    const { root, base } = fixture();
    try {
      writeFileSync(join(root, "payload.txt"), "payload\n");
      symlinkSync("payload.txt", join(root, "payload-link.txt"));
      const symlinked = digest(root, base);
      expect(symlinked.status).not.toBe(0);
      expect(symlinked.stderr).toMatch(/symlink|regular.file/i);

      rmSync(join(root, "payload-link.txt"));
      linkSync(join(root, "payload.txt"), join(root, "payload-hardlink.txt"));
      const hardlinked = digest(root, base);
      expect(hardlinked.status).not.toBe(0);
      expect(hardlinked.stderr).toMatch(/hardlink|multi.link|link count/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("unsafe components and special untracked files fail closed before content read", () => {
    const { root, base } = fixture();
    try {
      writeFileSync(join(root, "unsafe\\component.txt"), "unsafe path\n");
      const unsafe = digest(root, base);
      expect(unsafe.status).not.toBe(0);
      expect(unsafe.stderr).toMatch(/unsafe|canonical path/i);
      rmSync(join(root, "unsafe\\component.txt"));

      const fifo = join(root, "special.fifo");
      expect(run("mkfifo", [fifo], root).status).toBe(0);
      const special = digest(root, base, 1_000);
      expect(special.status).not.toBe(0);
      expect(special.signal).toBeNull();
      expect(special.stderr).toMatch(/special|regular.file/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the canonical recipe is versioned and descriptor-stable", () => {
    const identityModule = join(REPO_ROOT, "scripts", "stage-a-candidate-identity.ts");
    expect(existsSync(identityModule)).toBe(true);
    const source = existsSync(identityModule) ? readFileSync(identityModule, "utf8") : "";
    expect(source).toContain("todos-stage-a-candidate-identity-v5");
    expect(source).toContain("regular-file");
    expect(source).toContain("nlink");
    expect(source).toContain("O_NOFOLLOW");
    expect(source).toContain("changed while read");
  });

  test("a bundled library import cannot become the candidate CLI entrypoint", async () => {
    const directory = mkdtempSync(join(tmpdir(), "todos-candidate-v5-bundle-"));
    const outdir = join(directory, "dist");
    try {
      const identityModule = join(REPO_ROOT, "scripts", "stage-a-candidate-identity.ts");
      const entrypoint = join(directory, "verifier-entry.ts");
      writeFileSync(
        entrypoint,
        `import { STAGE_A_CANDIDATE_IDENTITY_VERSION } from ${JSON.stringify(identityModule)};\nprocess.stdout.write(STAGE_A_CANDIDATE_IDENTITY_VERSION + "\\n");\n`,
      );
      const build = await Bun.build({ entrypoints: [entrypoint], outdir, target: "bun" });
      expect(build.success, build.logs.map(String).join("\n")).toBe(true);
      const bundled = run(process.execPath, [join(outdir, "verifier-entry.js"), "--evidence", "/irrelevant"], directory);
      expect(bundled.status, bundled.stderr).toBe(0);
      expect(bundled.stdout.trim()).toBe(STAGE_A_CANDIDATE_IDENTITY_VERSION);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the V5 codec rejects duplicate paths, trailing bytes, and altered version markers", () => {
    expect(() => canonicalSortedUntrackedPaths(Buffer.from("duplicate.txt\0duplicate.txt\0")))
      .toThrow(/duplicate candidate path/i);

    const identity: CanonicalUntrackedIdentity = {
      path: "safe/file.txt",
      type: "regular-file",
      mode: "0640",
      size: 3,
      sha256: "0".repeat(64),
    };
    const { input } = canonicalCandidateInput(Buffer.from("tracked\0binary"), [identity]);
    expect(decodeCanonicalCandidateInput(input)).toEqual({
      version: STAGE_A_CANDIDATE_IDENTITY_VERSION,
      trackedDiff: Buffer.from("tracked\0binary"),
      untracked: [identity],
      untrackedRecords: input.subarray(
        Buffer.byteLength(`${STAGE_A_CANDIDATE_IDENTITY_VERSION}\0`) + 8 + Buffer.byteLength("tracked\0binary") + 4,
      ),
    });
    expect(() => decodeCanonicalCandidateInput(Buffer.concat([input, Buffer.from([0])]))).toThrow(/trailing bytes/i);
    const altered = Buffer.from(input);
    altered[0] = altered[0]! ^ 1;
    expect(() => decodeCanonicalCandidateInput(altered)).toThrow(/version marker/i);
  });
});
