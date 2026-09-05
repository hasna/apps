// Issue #1543: api-key signing secrets stored via the fleet provisioning
// pipeline carry a trailing newline (64 hex characters plus '\n'). Servers
// trim at env read; issue-key now does too, and the crypto layer normalizes
// string secrets at the HMAC boundary. These tests prove:
//   1. issue-key output is unaffected by the stored secret's trailing newline
//      (the newline never reaches the minted token), and
//   2. the verify/validate paths accept both storage forms of the secret.
//
// The acknowledged, pinned boundary: only STRING secrets are whitespace-
// normalized. Byte views are deliberate key material and stay byte-exact —
// the last block asserts that so a future change cannot silently widen (or
// narrow) the normalization without revisiting this doc.

import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKeyToken } from "../src/auth/keys";
import { verifyApiKey } from "../src/auth/middleware";
import { runIssueKey } from "../src/cli/issue-key";

const SIGNING = "test-signing-secret-not-a-real-credential-000";
const SIGNING_WITH_NEWLINE = `${SIGNING}\n`;
const APP = "todos";
const SCOPES = "todos:read";
// A pinned mint clock so a token minted here is valid when the middleware
// (real clock) checks it, while still being deterministic within a test.
const NOW_MS = Date.now() - 5_000;
const FIXED_KID = "fixed-kid-for-deterministic-mints";

function collectReports() {
  const reports: Array<{ error: string; details?: Record<string, unknown> }> = [];
  return {
    reports,
    report: (_o: { json?: boolean }, error: string, details?: Record<string, unknown>) => {
      reports.push({ error, ...(details ? { details } : {}) });
    },
  };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => void lines.push(args.map((a) => String(a)).join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

async function mintViaIssueKey(signingSecret: string): Promise<Record<string, unknown>> {
  const { reports, report } = collectReports();
  const out = await captureStdout(async () => {
    await runIssueKey(
      { app: APP, scopes: SCOPES, store: false, json: true },
      { report, env: { HASNA_TODOS_API_SIGNING_KEY: signingSecret }, now: () => NOW_MS },
    );
  });
  expect(reports).toEqual([]);
  return JSON.parse(out) as Record<string, unknown>;
}

describe("issue-key: the stored signing secret's trailing newline (issue #1543)", () => {
  test("mints a token unaffected by the stored value's trailing newline", async () => {
    const raw = await mintViaIssueKey(SIGNING_WITH_NEWLINE);
    const trimmed = await mintViaIssueKey(SIGNING);

    expect(raw.ok).toBe(true);
    expect(trimmed.ok).toBe(true);
    // Same claims: identical app/scopes/clock. The kid is random per issuance,
    // so the two runs cannot be byte-identical; what the newline must never
    // change is the SIGNING KEY, proven by the verification assertions below.
    expect(raw.app).toBe(APP);
    expect(raw.scopes).toEqual([SCOPES]);
    expect(raw.issuedAt).toBe(trimmed.issuedAt);
    expect(raw.expiresAt).toBe(trimmed.expiresAt);
  });

  test("the minted token itself carries no trailing whitespace", async () => {
    const raw = await mintViaIssueKey(SIGNING_WITH_NEWLINE);
    expect(typeof raw.token).toBe("string");
    expect((raw.token as string).endsWith("\n")).toBe(false);
    expect((raw.token as string).endsWith(" ")).toBe(false);
  });

  test("a key issued from the raw stored value verifies under BOTH storage forms", async () => {
    const raw = await mintViaIssueKey(SIGNING_WITH_NEWLINE);
    const token = String(raw.token);
    expect(verifyApiKeyToken(token, { signingSecret: SIGNING, expectedApp: APP }).ok).toBe(true);
    expect(verifyApiKeyToken(token, { signingSecret: SIGNING_WITH_NEWLINE, expectedApp: APP }).ok).toBe(true);
  });

  test("the generic fallback env is normalized the same way", async () => {
    const { reports, report } = collectReports();
    const out = await captureStdout(async () => {
      await runIssueKey(
        { app: APP, scopes: SCOPES, store: false, json: true },
        { report, env: { HASNA_API_SIGNING_KEY: SIGNING_WITH_NEWLINE }, now: () => NOW_MS },
      );
    });
    expect(reports).toEqual([]);
    const raw = JSON.parse(out) as { token: string };
    expect(verifyApiKeyToken(raw.token, { signingSecret: SIGNING, expectedApp: APP }).ok).toBe(true);
  });
});

describe("verify paths accept both storage forms of the signing secret (issue #1543)", () => {
  test("verifyApiKeyToken accepts the raw and the trimmed form interchangeably", () => {
    const minted = mintApiKey({
      app: APP,
      scopes: [SCOPES],
      signingSecret: SIGNING,
      kid: FIXED_KID,
      nowMs: NOW_MS,
    });
    expect(verifyApiKeyToken(minted.token, { signingSecret: SIGNING, expectedApp: APP }).ok).toBe(true);
    expect(verifyApiKeyToken(minted.token, { signingSecret: SIGNING_WITH_NEWLINE, expectedApp: APP }).ok).toBe(true);

    const mintedRaw = mintApiKey({
      app: APP,
      scopes: [SCOPES],
      signingSecret: SIGNING_WITH_NEWLINE,
      kid: FIXED_KID,
      nowMs: NOW_MS,
    });
    expect(verifyApiKeyToken(mintedRaw.token, { signingSecret: SIGNING, expectedApp: APP }).ok).toBe(true);
    expect(verifyApiKeyToken(mintedRaw.token, { signingSecret: SIGNING_WITH_NEWLINE, expectedApp: APP }).ok).toBe(true);
  });

  test("mint normalizes both forms to the same key", () => {
    const a = mintApiKey({ app: APP, scopes: [SCOPES], signingSecret: SIGNING, kid: FIXED_KID, nowMs: NOW_MS });
    const b = mintApiKey({
      app: APP,
      scopes: [SCOPES],
      signingSecret: SIGNING_WITH_NEWLINE,
      kid: FIXED_KID,
      nowMs: NOW_MS,
    });
    // Byte-identical token, hash, kid: the trailing newline never reaches the
    // signing input. This is the crypto-level proof that issue-key's output
    // "has no trailing newline".
    expect(b.token).toBe(a.token);
    expect(b.tokenHash).toBe(a.tokenHash);
  });

  test("a key issued from the raw stored value is accepted by the fleet-style verify path", async () => {
    // The acceptance criterion from the issue: `issue-key` run with the raw
    // Secrets Manager value produces a key every fleet server accepts. The
    // fleet wiring is `resolveSigningSecret(env)` (trims) + `verifyApiKey`.
    const raw = await mintViaIssueKey(SIGNING_WITH_NEWLINE);
    const verifier = verifyApiKey({ app: APP, signingSecret: SIGNING, allowUnregisteredKeys: true });
    const decision = await verifier.authenticate(
      { "x-api-key": String(raw.token) },
      { method: "GET", path: "/tasks" },
    );
    expect(decision.ok).toBe(true);
  });

  test("verifyApiKey middleware accepts either form at construction", async () => {
    const minted = mintApiKey({ app: APP, scopes: [SCOPES], signingSecret: SIGNING, kid: FIXED_KID, nowMs: NOW_MS });
    const verifier = verifyApiKey({ app: APP, signingSecret: SIGNING_WITH_NEWLINE, allowUnregisteredKeys: true });
    const decision = await verifier.authenticate(
      { "x-api-key": minted.token },
      { method: "GET", path: "/tasks" },
    );
    expect(decision.ok).toBe(true);
  });

  test("the entropy floor measures the normalized bytes", () => {
    // 64 hex characters plus a newline: the stored fleet shape. The floor runs
    // after conversion, so it must read 64 bytes and mint — not 65, and not a
    // refusal of a perfectly good secret.
    const hex64 = "a1".repeat(32);
    const opts = () => ({ app: APP, scopes: [SCOPES], kid: FIXED_KID, nowMs: NOW_MS });
    expect(() => mintApiKey({ ...opts(), signingSecret: `${hex64}\n` })).not.toThrow();
    expect(mintApiKey({ ...opts(), signingSecret: `${hex64}\n` }).token).toBe(
      mintApiKey({ ...opts(), signingSecret: hex64 }).token,
    );
  });

  test("byte-view secrets stay byte-exact — normalization is string-only", () => {
    // Documented boundary: a Buffer is deliberate key material, so its
    // trailing-whitespace bytes are meaningful and MUST NOT be trimmed. This
    // pins the asymmetry so a future change cannot silently widen (or narrow)
    // the normalization without revisiting the `SigningSecret` doc.
    const paddedBytes = Buffer.from(`${SIGNING}\n`, "utf8");
    const token = mintApiKey({
      app: APP,
      scopes: [SCOPES],
      signingSecret: paddedBytes,
      kid: FIXED_KID,
      nowMs: NOW_MS,
    }).token;
    expect(verifyApiKeyToken(token, { signingSecret: SIGNING }).ok).toBe(false);
    expect(verifyApiKeyToken(token, { signingSecret: paddedBytes }).ok).toBe(true);
  });
});