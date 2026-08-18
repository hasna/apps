import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  test("forces mode 600 on a pre-existing spool file", async () => {
    const dir = tempDir();
    try {
      // A caller-provided spoolDir may already hold a stdout.spool/stderr.spool
      // with permissive permissions; opening must not leave it readable.
      writeFileSync(join(dir, "stdout.spool"), "old-content", { mode: 0o644 });
      writeFileSync(join(dir, "stderr.spool"), "old-content", { mode: 0o644 });

      const result = await captureCommandOutput("bash", ["-c", "echo hello; echo boom >&2"], {
        spoolDir: dir,
      });

      expect(result.exitCode).toBe(0);
      expect(statSync(result.stdout.path).mode & 0o777).toBe(0o600);
      expect(statSync(result.stderr.path).mode & 0o777).toBe(0o600);
    } finally {
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
