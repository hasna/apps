// Test-gap remediation: agent-authored (SOL consult refused — model at capacity).
// Covers src/core/security.ts, which had NO direct tests: filename sanitization,
// object-key construction, password hashing, Content-Disposition encoding, and
// email validation are all exercised only transitively (or not at all) elsewhere.

import { describe, expect, test } from "bun:test";
import {
  buildPasswordHash,
  contentDispositionAttachment,
  createObjectKey,
  generateShareToken,
  hashShareToken,
  isValidEmail,
  normalizeEmail,
  sanitizeFilename,
  verifyPasswordHash,
} from "./security";

describe("sanitizeFilename", () => {
  test("strips path components down to the basename", () => {
    expect(sanitizeFilename("/a/b/c.txt")).toBe("c.txt");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
  });

  test("basename strips forward-slash path components first", () => {
    // basename() runs before the separator replacement, so a forward slash
    // never survives to the replacement pass.
    expect(sanitizeFilename("a/b.txt")).toBe("b.txt");
  });

  test("replaces backslashes with dashes (basename does not split on them)", () => {
    expect(sanitizeFilename("a\\b.txt")).toBe("a-b.txt");
  });

  test("strips control characters and trims", () => {
    expect(sanitizeFilename("  \u0000evil\u001f.txt  ")).toBe("evil.txt");
    expect(sanitizeFilename("\x7fDEL.txt")).toBe("DEL.txt");
  });

  test("collapses whitespace runs to single spaces (tab is a control char and is stripped)", () => {
    expect(sanitizeFilename("a   b\tc.txt")).toBe("a bc.txt");
    expect(sanitizeFilename("a   b  c.txt")).toBe("a b c.txt");
  });

  test("falls back to 'attachment' when nothing remains", () => {
    expect(sanitizeFilename("")).toBe("attachment");
    expect(sanitizeFilename("   ")).toBe("attachment");
    expect(sanitizeFilename("\u0000\u0001")).toBe("attachment");
  });

  test("preserves unicode letters (only control + separator bytes are stripped)", () => {
    expect(sanitizeFilename("raport-anexă.txt")).toBe("raport-anexă.txt");
  });
});

describe("createObjectKey", () => {
  test("builds the dated path with id and a random suffix", () => {
    const now = new Date(Date.UTC(2026, 7, 19, 23, 59, 59)); // Aug 19 2026 UTC
    const key = createObjectKey("att_123", "photo.png", now);
    expect(key.startsWith("attachments/2026-08-19/att_123/")).toBe(true);
    // 18-char nanoid + original extension
    const tail = key.slice("attachments/2026-08-19/att_123/".length);
    expect(tail).toMatch(/^[A-Za-z0-9_-]{18}\.png$/);
  });

  test("uses UTC components regardless of local timezone", () => {
    // Local timezone here could be anything; the key must be UTC-based.
    const now = new Date("2026-01-01T00:30:00.000Z");
    const key = createObjectKey("att_1", "f.bin", now);
    expect(key.startsWith("attachments/2026-01-01/")).toBe(true);
  });

  test("truncates a pathological extension to 24 characters (dot included)", () => {
    const key = createObjectKey("att_1", `f.${"x".repeat(60)}`, new Date(0));
    const tail = key.slice(key.lastIndexOf("."));
    expect(tail.length).toBe(24); // extname().slice(0, 24) keeps the dot inside the cap
    expect(tail.startsWith(".")).toBe(true);
    expect(key).toMatch(/^attachments\/1970-01-01\/att_1\/[A-Za-z0-9_-]{18}\.x{23}$/);
  });

  test("produces a different suffix on every call", () => {
    const now = new Date(0);
    expect(createObjectKey("att_1", "a.txt", now)).not.toBe(createObjectKey("att_1", "a.txt", now));
  });
});

describe("buildPasswordHash / verifyPasswordHash", () => {
  test("round-trips a correct password", () => {
    const hash = buildPasswordHash("Parola-Test-1");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPasswordHash("Parola-Test-1", hash)).toBe(true);
  });

  test("rejects a wrong password", () => {
    const hash = buildPasswordHash("correct");
    expect(verifyPasswordHash("wrong", hash)).toBe(false);
  });

  test("two hashes of the same password differ (unique salt)", () => {
    expect(buildPasswordHash("same")).not.toBe(buildPasswordHash("same"));
  });

  test("null hash means no password required", () => {
    expect(verifyPasswordHash("anything", null)).toBe(true);
    expect(verifyPasswordHash("", null)).toBe(true);
  });

  test("rejects malformed hashes without throwing", () => {
    // Empty string is falsy and is treated like null (no password required).
    expect(verifyPasswordHash("x", "")).toBe(true);
    expect(verifyPasswordHash("x", "plaintext")).toBe(false);
    expect(verifyPasswordHash("x", "md5$salt$hash")).toBe(false);
    expect(verifyPasswordHash("x", "scrypt$salthash")).toBe(false);
    expect(verifyPasswordHash("x", "scrypt$$")).toBe(false);
    expect(verifyPasswordHash("x", "scrypt$salt$")).toBe(false);
  });
});

describe("contentDispositionAttachment", () => {
  test("emits plain ascii filename and no filename* when name is ascii", () => {
    const cd = contentDispositionAttachment("report.pdf");
    expect(cd).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
  });

  test("non-ascii names get an ascii fallback plus the encoded filename* (RFC 6266)", () => {
    // Regression: a raw diacritic in the quoted filename made the HTTP header
    // invalid and every download of such a file 500'd.
    const cd = contentDispositionAttachment("raport-anexă.txt");
    expect(cd).toContain('filename="raport-anex_.txt"');
    expect(cd).toContain("filename*=UTF-8''raport-anex%C4%83.txt");
  });

  test("strips quotes and backslashes from the quoted form", () => {
    // The backslash is normalized to a dash by sanitizeFilename before quotes
    // are removed, so it survives as a dash in the quoted name.
    const cd = contentDispositionAttachment('evil"name\\x.txt');
    expect(cd).toContain('filename="evilname-x.txt"');
    expect(cd).not.toContain('evil"name');
  });

  test("falls back to 'attachment' when the name is empty after sanitization", () => {
    const cd = contentDispositionAttachment("\u0000\u0000");
    expect(cd.startsWith('attachment; filename="attachment"')).toBe(true);
  });
});

describe("email helpers", () => {
  test("normalizeEmail lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });

  test("isValidEmail accepts well-formed addresses", () => {
    expect(isValidEmail("a@b.c")).toBe(true);
    expect(isValidEmail("a.b+c@sub.domain.co")).toBe(true);
    expect(isValidEmail("  a@b.c  ")).toBe(true); // trimmed before validation
  });

  test("isValidEmail rejects malformed addresses", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false); // no dot in domain
    expect(isValidEmail("a b@c.d")).toBe(false); // space in local part
    expect(isValidEmail("a@b@c.d")).toBe(false); // two @
    expect(isValidEmail("@b.c")).toBe(false); // empty local part
    expect(isValidEmail("a@.c")).toBe(false); // empty domain label
  });

  test("isValidEmail rejects over-long addresses", () => {
    // "@b.c" is 4 chars, so 250 local chars is exactly 254 total (allowed).
    expect(isValidEmail(`${"a".repeat(250)}@b.c`)).toBe(true);
    expect(isValidEmail(`${"a".repeat(251)}@b.c`)).toBe(false); // 255 total
  });
});

describe("share tokens", () => {
  test("generateShareToken returns a 32-char token and tokens differ", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  test("hashShareToken is a deterministic 64-char sha256 hex", () => {
    const hash = hashShareToken("token-abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken("token-abc")).toBe(hash);
    expect(hashShareToken("token-abc")).not.toBe(hashShareToken("token-abd"));
  });
});
