import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRunEvidence,
  buildStreamEvidence,
  containsCredentialShape,
  redactOutputText,
} from "./output-evidence.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "monitor-evidence-"));
}

describe("redactOutputText", () => {
  test("redacts sensitive key=value assignments", () => {
    const result = redactOutputText("login token=abc123-secret continue");
    expect(result.text).toBe("login token=*** continue");
    expect(result.redacted).toBe(true);
  });

  test("redacts long-option values for sensitive keys", () => {
    const result = redactOutputText("--api-key=xyz --token raw --password p4ss");
    expect(result.text).toBe("--api-key=*** --token *** --password ***");
    expect(result.redacted).toBe(true);
  });

  test("redacts URL-embedded credentials", () => {
    const result = redactOutputText("connect https://user:supersecret@db.example.com/db");
    expect(result.text).toBe("connect https://***@db.example.com/db");
    expect(result.redacted).toBe(true);
  });

  test("redacts credential-shaped query parameters in URLs", () => {
    const result = redactOutputText(
      "download https://cdn.example.invalid/file.bin?token=abc123&X-Amz-Signature=deadbeef&x=1"
    );
    expect(result.text).toBe(
      "download https://cdn.example.invalid/file.bin?token=***&X-Amz-Signature=***&x=1"
    );
    expect(result.redacted).toBe(true);
  });

  test("redacts credential-shaped fragment parameters in URLs", () => {
    const result = redactOutputText("auth https://id.example.invalid/callback#access_token=xyz&type=code");
    expect(result.text).toBe("auth https://id.example.invalid/callback#access_token=***&type=code");
    expect(result.redacted).toBe(true);
  });

  test("leaves benign query parameters intact", () => {
    const text = "search https://example.invalid/search?q=hello&page=2";
    const result = redactOutputText(text);
    expect(result.text).toBe(text);
    expect(result.redacted).toBe(false);
  });

  test("redacts known credential prefixes", () => {
    // Runtime-constructed sentinel: the literal credential shape never appears
    // in source, keeping the staged secrets scan clean for a synthetic fixture.
    const credential = ["sk-ant-api03", "abcdefghijklmnopqrstuvwxyz"].join("-");
    const result = redactOutputText(`key=${credential} value`);
    expect(result.text).toContain("***");
    expect(result.redacted).toBe(true);
  });

  test("redacts Authorization header Bearer values", () => {
    // Runtime-constructed sentinel: the literal credential shape never appears
    // in source, keeping the staged secrets scan clean for a synthetic fixture.
    const prefix = ["sk", "ant", "api03"].join("-");
    const credential = [prefix, "abcdefghijklmnopqrstuvwxyz"].join("-");
    const result = redactOutputText(`Authorization: Bearer ${credential} continue`);
    expect(result.text).not.toContain(credential);
    expect(result.text).toContain("***");
    expect(result.redacted).toBe(true);
  });

  test("redacts colon-separated header values for sensitive keys", () => {
    const result = redactOutputText("X-Api-Key: abc123-secret\nAuthorization: topsecret-value");
    expect(result.text).toContain("X-Api-Key: ***");
    expect(result.text).toContain("Authorization: ***");
    expect(result.text).not.toContain("abc123-secret");
    expect(result.text).not.toContain("topsecret-value");
    expect(result.redacted).toBe(true);
  });

  test("redacts semicolon-separated credential query parameters", () => {
    const result = redactOutputText(
      "download https://cdn.example.invalid/file.bin?ok=1;token=supersecret&x=2"
    );
    expect(result.text).toBe("download https://cdn.example.invalid/file.bin?ok=1;token=***&x=2");
    expect(result.text).not.toContain("supersecret");
    expect(result.redacted).toBe(true);
  });

  test("leaves non-sensitive colon-separated prose intact", () => {
    const text = "Time: 12:30 note: plain value";
    const result = redactOutputText(text);
    expect(result.text).toBe(text);
    expect(result.redacted).toBe(false);
  });

  test("leaves clean text unchanged and reports redacted=false", () => {
    const text = "All checks passed. 3 machines healthy. READY";
    const result = redactOutputText(text);
    expect(result.text).toBe(text);
    expect(result.redacted).toBe(false);
  });

  test("containsCredentialShape agrees with the redactor", () => {
    expect(containsCredentialShape("token=abc123")).toBe(true);
    expect(containsCredentialShape("Authorization: Bearer value123")).toBe(true);
    expect(containsCredentialShape("https://host/path?ok=1;token=abc")).toBe(true);
    expect(containsCredentialShape("plain output line")).toBe(false);
  });
});

describe("buildStreamEvidence", () => {
  test("retains a bounded, redacted excerpt from the spool file", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "stdout.spool");
      writeFileSync(path, "line one\ntoken=sekrit\nline three\n", { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stdout",
        path,
        bytes: 29,
        truncated: false,
        maxExcerptBytes: 512,
        redact: true,
      });

      expect(evidence.retained).toBe(true);
      expect(evidence.excerpt).toBe("line one\ntoken=***\nline three\n");
      expect(evidence.redacted).toBe(true);
      expect(evidence.omittedReason).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bounds the excerpt to maxExcerptBytes and flags truncation", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "stdout.spool");
      writeFileSync(path, "abcdefghij", { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stdout",
        path,
        bytes: 10,
        truncated: true,
        maxExcerptBytes: 4,
        redact: true,
      });

      expect(evidence.retained).toBe(true);
      expect(evidence.excerpt).toBe("abcd");
      expect(evidence.truncated).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing spool file yields omittedReason=missing instead of throwing", async () => {
    const dir = tempDir();
    try {
      const evidence = await buildStreamEvidence({
        kind: "stderr",
        path: join(dir, "does-not-exist.spool"),
        bytes: 0,
        truncated: false,
        maxExcerptBytes: 512,
        redact: true,
      });

      expect(evidence.retained).toBe(false);
      expect(evidence.omittedReason).toBe("missing");
      expect(evidence.excerpt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sensitive stream yields evidence_omitted_sensitive and no excerpt", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "stderr.spool");
      writeFileSync(path, "payload bytes", { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stderr",
        path,
        bytes: 12,
        truncated: false,
        maxExcerptBytes: 512,
        redact: true,
        omitSensitive: true,
      });

      expect(evidence.retained).toBe(false);
      expect(evidence.omittedReason).toBe("sensitive");
      expect(evidence.excerpt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unredacted retention is refused when the excerpt carries credential shape", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "stdout.spool");
      writeFileSync(path, "password=secretvalue", { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stdout",
        path,
        bytes: 20,
        truncated: false,
        maxExcerptBytes: 512,
        redact: false,
      });

      expect(evidence.retained).toBe(false);
      expect(evidence.omittedReason).toBe("sensitive");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("redacts a URL whose authority crosses the excerpt cap", async () => {
    const dir = tempDir();
    try {
      // The '@' of the URL sits beyond maxExcerptBytes: a truncated-then-redacted
      // excerpt would carry the "user:supersecret" prefix verbatim.
      const path = join(dir, "stdout.spool");
      writeFileSync(path, "https://user:supersecret@host.example.invalid/path", { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stdout",
        path,
        bytes: 47,
        truncated: true,
        maxExcerptBytes: 20,
        redact: true,
      });

      expect(evidence.retained).toBe(true);
      expect(evidence.excerpt).not.toContain("user:");
      expect(evidence.excerpt).not.toContain("supersecret");
      expect(evidence.excerpt).toContain("***");
      expect(evidence.excerpt!.length).toBeLessThanOrEqual(20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses unredacted retention when a credential sits beyond the excerpt cap", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "stdout.spool");
      // The credential starts after the excerpt cap, at a token boundary.
      writeFileSync(path, `${"a".repeat(2048)}\ntoken=sekrit`, { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stdout",
        path,
        bytes: 2060,
        truncated: true,
        maxExcerptBytes: 1024,
        redact: false,
      });

      // The credential is cut by the cap, so the redactor must refuse the
      // unredacted retention instead of keeping a truncated credential.
      expect(evidence.retained).toBe(false);
      expect(evidence.omittedReason).toBe("sensitive");
      expect(evidence.excerpt).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bounds the excerpt when the spool is much larger than the cap", async () => {
    const dir = tempDir();
    try {
      const path = join(dir, "stdout.spool");
      writeFileSync(path, "a".repeat(1024 * 1024), { mode: 0o600 });

      const evidence = await buildStreamEvidence({
        kind: "stdout",
        path,
        bytes: 1024 * 1024,
        truncated: true,
        maxExcerptBytes: 1024,
        redact: true,
      });

      expect(evidence.retained).toBe(true);
      expect(evidence.excerpt!.length).toBe(1024);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildRunEvidence", () => {
  test("aggregates stream evidence and reports evidence_omitted_sensitive", async () => {
    const dir = tempDir();
    try {
      const stdoutPath = join(dir, "stdout.spool");
      const stderrPath = join(dir, "stderr.spool");
      writeFileSync(stdoutPath, "ok", { mode: 0o600 });
      writeFileSync(stderrPath, "boom", { mode: 0o600 });

      const evidence = await buildRunEvidence({
        streams: [
          { kind: "stdout", path: stdoutPath, bytes: 2, truncated: false },
          { kind: "stderr", path: stderrPath, bytes: 4, truncated: false },
        ],
        maxExcerptBytes: 512,
        redact: true,
      });

      expect(evidence.streams).toHaveLength(2);
      expect(evidence.streams[0]?.retained).toBe(true);
      expect(evidence.streams[0]?.excerpt).toBe("ok");
      expect(evidence.streams[1]?.excerpt).toBe("boom");
      expect(evidence.evidence_omitted_sensitive).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flags evidence_omitted_sensitive when any stream is omitted as sensitive", async () => {
    const dir = tempDir();
    try {
      const stdoutPath = join(dir, "stdout.spool");
      writeFileSync(stdoutPath, "api_key=hunter2", { mode: 0o600 });

      const evidence = await buildRunEvidence({
        streams: [{ kind: "stdout", path: stdoutPath, bytes: 14, truncated: false }],
        maxExcerptBytes: 512,
        redact: false,
      });

      expect(evidence.streams[0]?.retained).toBe(false);
      expect(evidence.evidence_omitted_sensitive).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
