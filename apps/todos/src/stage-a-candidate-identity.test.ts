import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
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
  type CanonicalTrackedIdentity,
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
  const root = mkdtempSync(join(tmpdir(), "todos-candidate-v6-"));
  expect(run("git", ["init", "-q"], root).status).toBe(0);
  writeFileSync(join(root, "tracked.txt"), "tracked\n");
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  expect(run("git", ["add", "tracked.txt", ".gitignore"], root).status).toBe(0);
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

async function mutateDuringSlowCandidateRead(
  root: string,
  base: string,
  mutate: () => void,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const slowPath = join(root, "zz-slow.bin");
  writeFileSync(slowPath, "");
  truncateSync(slowPath, 256 * 1024 * 1024);
  const child = Bun.spawn(["bash", CANDIDATE_SCRIPT, base, "candidate"], {
    cwd: root,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C",
      BUN_EXECUTABLE: process.execPath,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 5_000;
  let observedSlowRead = false;
  while (Date.now() < deadline && !observedSlowRead) {
    try {
      observedSlowRead = readdirSync(`/proc/${child.pid}/fd`).some((descriptor) => {
        try {
          return readlinkSync(`/proc/${child.pid}/fd/${descriptor}`) === slowPath;
        } catch {
          return false;
        }
      });
    } catch {
      // The child can briefly replace itself while the descriptor table changes.
    }
    if (!observedSlowRead) await Bun.sleep(1);
  }
  expect(observedSlowRead).toBe(true);
  await Bun.sleep(20);
  mutate();

  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

describe("Stage A V6 canonical candidate identity", () => {
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

  test.each(["tracked", "untracked"] as const)(
    "%s regular-file mode, size, and content are all part of the canonical identity",
    (scope) => {
      const { root, base } = fixture();
      try {
        const path = join(root, scope === "tracked" ? "tracked.txt" : "untracked.txt");
        if (scope === "untracked") writeFileSync(path, "tracked\n");
        chmodSync(path, 0o644);
        const baseline = digest(root, base);
        expect(baseline.status, baseline.stderr).toBe(0);

        chmodSync(path, 0o755);
        const modeChanged = digest(root, base);
        expect(modeChanged.status, modeChanged.stderr).toBe(0);

        chmodSync(path, 0o644);
        writeFileSync(path, "TRACKED\n");
        const contentChanged = digest(root, base);
        expect(contentChanged.status, contentChanged.stderr).toBe(0);

        writeFileSync(path, "different size\n");
        const sizeChanged = digest(root, base);
        expect(sizeChanged.status, sizeChanged.stderr).toBe(0);

        expect(new Set([
          baseline.stdout.trim(),
          modeChanged.stdout.trim(),
          contentChanged.stdout.trim(),
          sizeChanged.stdout.trim(),
        ]).size).toBe(4);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

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

  test("an externally hardlinked tracked input is rejected", () => {
    const { root, base } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "todos-candidate-v6-external-hardlink-"));
    try {
      linkSync(join(root, "tracked.txt"), join(outside, "tracked-alias.txt"));
      const result = digest(root, base);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/tracked.*(hardlink|multi.link|link count)|multi.link.*tracked/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a tracked symlink is rejected", () => {
    const { root, base } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "todos-candidate-v6-external-symlink-"));
    try {
      const outsidePayload = join(outside, "payload.txt");
      writeFileSync(outsidePayload, "externally mutable\n");
      rmSync(join(root, "tracked.txt"));
      symlinkSync(outsidePayload, join(root, "tracked.txt"));
      const result = digest(root, base);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/tracked.*(symlink|regular.file)|symlink.*tracked/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a persistent file created in the V5 twenty-millisecond stale-success window is rejected", async () => {
    const { root, base } = fixture();
    try {
      const created = join(root, "created-during-hash.txt");
      const result = await mutateDuringSlowCandidateRead(root, base, () => {
        writeFileSync(created, "persistent mutation\n");
      });
      expect(existsSync(created)).toBe(true);
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toMatch(/changed|inventory|snapshot|closure/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each(["removed", "renamed", "relinked", "mode-changed"] as const)(
    "a persistent file %s during hashing invalidates the closed-world snapshot",
    async (operation) => {
      const { root, base } = fixture();
      try {
        const victim = join(root, "aa-race-victim.txt");
        const renamed = join(root, "aa-race-renamed.txt");
        writeFileSync(victim, "stable bytes\n");
        chmodSync(victim, 0o644);
        const result = await mutateDuringSlowCandidateRead(root, base, () => {
          if (operation === "removed") rmSync(victim);
          else if (operation === "renamed") renameSync(victim, renamed);
          else if (operation === "relinked") {
            rmSync(victim);
            writeFileSync(victim, "stable bytes\n");
            chmodSync(victim, 0o644);
          } else chmodSync(victim, 0o755);
        });
        expect(result.status, result.stderr).not.toBe(0);
        expect(result.stderr).toMatch(/changed|inventory|snapshot|closure/i);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test("a persistent mode change inside an ignored directory invalidates the full filesystem closure", async () => {
    const { root, base } = fixture();
    try {
      const ignoredDirectory = join(root, "ignored");
      const ignoredFile = join(ignoredDirectory, "nested.txt");
      mkdirSync(ignoredDirectory);
      writeFileSync(ignoredFile, "ignored stable bytes\n");
      chmodSync(ignoredFile, 0o644);
      const result = await mutateDuringSlowCandidateRead(root, base, () => chmodSync(ignoredFile, 0o755));
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toMatch(/changed|snapshot|closure/i);
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
    expect(source).toContain("todos-stage-a-candidate-identity-v6");
    expect(source).toContain("tracked-file");
    expect(source).toContain("untracked-file");
    expect(source).toContain("nlink");
    expect(source).toContain("O_NOFOLLOW");
    expect(source).toContain("changed while read");
    expect(source).toContain("candidate stable snapshot changed");
  });

  test("a bundled library import cannot become the candidate CLI entrypoint", async () => {
    const directory = mkdtempSync(join(tmpdir(), "todos-candidate-v6-bundle-"));
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

  test("the V6 codec rejects duplicate paths, trailing bytes, and altered version markers", () => {
    expect(() => canonicalSortedUntrackedPaths(Buffer.from("duplicate.txt\0duplicate.txt\0")))
      .toThrow(/duplicate candidate .*path/i);

    const tracked: CanonicalTrackedIdentity[] = [{
      path: "safe/deleted.txt",
      type: "absent",
    }, {
      path: "safe/tracked.txt",
      type: "regular-file",
      mode: "0644",
      size: 4,
      sha256: "1".repeat(64),
    }];
    const untracked: CanonicalUntrackedIdentity[] = [{
      path: "safe/untracked.txt",
      type: "regular-file",
      mode: "0640",
      size: 3,
      sha256: "0".repeat(64),
    }];
    const encoded = canonicalCandidateInput(Buffer.from("tracked\0binary"), tracked, untracked);
    const { input } = encoded;
    expect(decodeCanonicalCandidateInput(input)).toEqual({
      version: STAGE_A_CANDIDATE_IDENTITY_VERSION,
      trackedDiff: Buffer.from("tracked\0binary"),
      tracked,
      trackedRecords: encoded.trackedRecords,
      untracked,
      untrackedRecords: encoded.untrackedRecords,
    });
    expect(() => decodeCanonicalCandidateInput(Buffer.concat([input, Buffer.from([0])]))).toThrow(/trailing bytes/i);
    const altered = Buffer.from(input);
    altered[0] = altered[0]! ^ 1;
    expect(() => decodeCanonicalCandidateInput(altered)).toThrow(/version marker/i);
  });
});
