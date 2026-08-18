import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandOutput, removeCaptureSpool } from "./output-capture.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "monitor-capture-"));
}

describe("captureCommandOutput", () => {
  test("captures stdout and stderr into mode-600 files and preserves the exit code", async () => {
    const dir = tempDir();
    try {
      const result = await captureCommandOutput("bash", ["-c", "echo hello; echo boom >&2; exit 3"], {
        spoolDir: dir,
      });

      expect(result.exitCode).toBe(3);
      expect(result.timedOut).toBe(false);
      expect(result.error).toBeUndefined();

      expect(readFileSync(result.stdout.path, "utf8")).toBe("hello\n");
      expect(readFileSync(result.stderr.path, "utf8")).toBe("boom\n");

      // Permissions: both spool files are owner-only (mode 600).
      expect(statSync(result.stdout.path).mode & 0o777).toBe(0o600);
      expect(statSync(result.stderr.path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bounds each stream by maxBytes and reports truncation", async () => {
    const dir = tempDir();
    try {
      const result = await captureCommandOutput("bash", ["-c", "printf 'abcdefghij'"], {
        spoolDir: dir,
        maxStdoutBytes: 4,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.bytes).toBe(10);
      expect(result.stdout.truncated).toBe(true);
      expect(readFileSync(result.stdout.path, "utf8")).toBe("abcd");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applies per-stream bounds independently", async () => {
    const dir = tempDir();
    try {
      const result = await captureCommandOutput(
        "bash",
        ["-c", "printf 'xxxxxxxxxx'; printf 'yyyy' >&2"],
        {
          spoolDir: dir,
          maxStdoutBytes: 3,
          maxStderrBytes: 4,
        }
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.bytes).toBe(10);
      expect(result.stdout.truncated).toBe(true);
      expect(readFileSync(result.stdout.path, "utf8")).toBe("xxx");
      expect(result.stderr.bytes).toBe(4);
      expect(result.stderr.truncated).toBe(false);
      expect(readFileSync(result.stderr.path, "utf8")).toBe("yyyy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kills a timed-out process and reports timedOut with a null exit code", async () => {
    const dir = tempDir();
    try {
      const result = await captureCommandOutput("bash", ["-c", "sleep 30; echo never"], {
        spoolDir: dir,
        timeoutMs: 300,
      });

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.error).toContain("timed out");
      expect(result.stdout.bytes).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses structured argv without shell interpolation", async () => {
    const dir = tempDir();
    const marker = join(dir, "interpolated");
    try {
      const result = await captureCommandOutput("bash", ["-c", "printf '%s' \"$1\"", "arg0", "$(touch '${marker}')"], {
        spoolDir: dir,
      });

      expect(result.exitCode).toBe(0);
      // The argv value must have been passed literally, never executed.
      expect(existsSync(marker)).toBe(false);
      expect(result.stdout.bytes).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns a typed error result when the executable does not exist", async () => {
    const dir = tempDir();
    try {
      const result = await captureCommandOutput(join(dir, "definitely-missing-bin"), [], { spoolDir: dir });

      expect(result.exitCode).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("never opens pre-existing files at the legacy fixed spool names", async () => {
    const dir = tempDir();
    try {
      // A caller-provided spoolDir may hold files at the old shared names; a
      // capture must never truncate, chmod, or otherwise touch them.
      writeFileSync(join(dir, "stdout.spool"), "old-content", { mode: 0o644 });
      writeFileSync(join(dir, "stderr.spool"), "old-content", { mode: 0o644 });

      const result = await captureCommandOutput("bash", ["-c", "echo hello; echo boom >&2"], {
        spoolDir: dir,
      });

      expect(result.exitCode).toBe(0);
      // The capture wrote to its own per-capture files, owner-only.
      expect(readFileSync(result.stdout.path, "utf8")).toBe("hello\n");
      expect(statSync(result.stdout.path).mode & 0o777).toBe(0o600);
      expect(statSync(result.stderr.path).mode & 0o777).toBe(0o600);
      // The legacy-named files are untouched: content and mode preserved.
      expect(readFileSync(join(dir, "stdout.spool"), "utf8")).toBe("old-content");
      expect(statSync(join(dir, "stdout.spool")).mode & 0o777).toBe(0o644);
      expect(readFileSync(join(dir, "stderr.spool"), "utf8")).toBe("old-content");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("concurrent captures in one caller-provided spoolDir use per-capture files and cleanup never removes another capture's output", async () => {
    const dir = tempDir();
    try {
      const first = await captureCommandOutput("bash", ["-c", "echo first"], { spoolDir: dir });
      const second = await captureCommandOutput("bash", ["-c", "echo second"], { spoolDir: dir });

      // Per-capture spool files: neither capture reused the other's paths.
      expect(first.stdout.path).not.toBe(second.stdout.path);
      expect(first.stderr.path).not.toBe(second.stderr.path);
      expect(readFileSync(first.stdout.path, "utf8")).toBe("first\n");
      expect(readFileSync(second.stdout.path, "utf8")).toBe("second\n");

      // Cleaning the first capture must not delete the second capture's files.
      removeCaptureSpool(first);
      expect(existsSync(first.stdout.path)).toBe(false);
      expect(existsSync(second.stdout.path)).toBe(true);
      expect(readFileSync(second.stdout.path, "utf8")).toBe("second\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a pre-existing symlink at a legacy spool name is never followed", async () => {
    const dir = tempDir();
    try {
      const victim = join(dir, "victim.txt");
      writeFileSync(victim, "precious", { mode: 0o600 });
      symlinkSync(victim, join(dir, "stdout.spool"));

      const result = await captureCommandOutput("bash", ["-c", "echo hello"], { spoolDir: dir });

      expect(result.exitCode).toBe(0);
      // The capture wrote its own file; the symlink target was never opened.
      expect(readFileSync(victim, "utf8")).toBe("precious");
      expect(readFileSync(result.stdout.path, "utf8")).toBe("hello\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a setup failure returns uncreated per-capture spool paths and cleanup deletes nothing", async () => {
    const dir = tempDir();
    let stdoutPath = "";
    let stderrPath = "";
    try {
      const result = await captureCommandOutput("bash", ["-c", "echo hi"], {
        spoolDir: join(dir, "does-not-exist"),
      });

      expect(result.error).toBeDefined();
      expect(result.stdout.created).toBe(false);
      expect(result.stderr.created).toBe(false);
      // Never a shared fixed /tmp pattern that another process could own.
      expect(result.stdout.path).not.toBe(join(tmpdir(), "monitor-stdout.spool"));
      expect(result.stderr.path).not.toBe(join(tmpdir(), "monitor-stderr.spool"));

      // Sentinels planted at the returned (uncreated) paths must survive
      // cleanup: nothing this capture did not create may be removed.
      stdoutPath = result.stdout.path;
      stderrPath = result.stderr.path;
      writeFileSync(stdoutPath, "sentinel", { mode: 0o600 });
      writeFileSync(stderrPath, "sentinel", { mode: 0o600 });

      removeCaptureSpool(result);

      expect(existsSync(stdoutPath)).toBe(true);
      expect(existsSync(stderrPath)).toBe(true);
    } finally {
      rmSync(stdoutPath, { force: true });
      rmSync(stderrPath, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removeCaptureSpool leaves a caller-provided directory and unrelated files intact", async () => {
    const dir = tempDir();
    try {
      const unrelated = join(dir, "keep-me.txt");
      writeFileSync(unrelated, "unrelated content", { mode: 0o600 });

      const result = await captureCommandOutput("bash", ["-c", "echo hello; echo boom >&2"], {
        spoolDir: dir,
      });

      removeCaptureSpool(result);

      // Only the two spool files this capture created may be removed; the
      // caller's directory and anything else inside it must survive.
      expect(existsSync(result.stdout.path)).toBe(false);
      expect(existsSync(result.stderr.path)).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
      expect(existsSync(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns a typed result when the spool directory does not exist", async () => {
    const dir = tempDir();
    try {
      const result = await captureCommandOutput("bash", ["-c", "echo hi"], {
        spoolDir: join(dir, "does-not-exist"),
      });

      expect(result.exitCode).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("spoolDir does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
