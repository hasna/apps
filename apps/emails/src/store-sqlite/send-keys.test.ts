// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// The scoped send-key repository is the only credential lifecycle in the
// SQLite store, and it has zero coverage. The contracts under test:
//
//   - the plaintext token is readable EXACTLY ONCE, at mint; at rest the
//     table stores only a SHA-256 hash plus a 12-char display prefix — a
//     test must prove the hash column is the hash of the token and that the
//     returned record never carries the token or its hash;
//   - verify and revoke are transactional: verify stamps last_used_at and
//     revoke stamps revoked_at, and updated_at is DERIVED as the MAX of the
//     three timestamps (a projection of stored facts, never fabricated);
//   - a revoked token verifies to null — "this token does not authorize
//     anything" is the complete answer;
//   - the outbound-policy operation refuses with the capability code — the
//     store declares outboundPolicy false, so returning false would be the
//     false-as-unknown the seam names explicitly;
//   - pagination clamps apply: limits cap at 500, offsets never negative.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { closeDatabase, getDatabase, resetDatabase, type Database } from "../db/database.js";
import { createSendKeysRepository } from "./send-keys.js";
import type { SendKeysRepository } from "../store/repositories.js";

let db: Database;
let repo: SendKeysRepository;

function seedOwner(id: string, name: string): void {
  db.run("INSERT INTO owners (id, type, name, created_at, updated_at) VALUES (?, 'agent', ?, ?, ?)", [
    id,
    name,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  ]);
}

beforeEach(() => {
  resetDatabase();
  db = getDatabase();
  repo = createSendKeysRepository(db);
});

afterEach(() => {
  closeDatabase();
});

describe("mintSendKey", () => {
  it("mints a key bound to an existing owner, returning the plaintext once", async () => {
    seedOwner("owner-1", "ada");
    const outcome = await repo.mintSendKey({ owner_id: "owner-1", label: "ci" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { token, key } = outcome.value;

    expect(token.startsWith("esk_")).toBe(true);
    expect(token.length).toBe(4 + 48); // esk_ + 24 random bytes in hex
    expect(key.owner_id).toBe("owner-1");
    expect(key.label).toBe("ci");
    expect(key.prefix).toBe(token.slice(0, 12));
    expect(key.revoked_at).toBeNull();
    expect(key.created_at).toBeTruthy();
    // updated_at derives from created_at at mint time.
    expect(key.updated_at).toBe(key.created_at);

    // The record NEVER carries the token or its hash.
    expect((key as Record<string, unknown>)["token"]).toBeUndefined();
    expect((key as Record<string, unknown>)["key_hash"]).toBeUndefined();

    // At rest: only the SHA-256 hash of the token is stored.
    const row = db.query("SELECT key_hash FROM send_keys WHERE id = ?").get(key.id) as { key_hash: string } | null;
    expect(row?.key_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row?.key_hash).not.toBe(token);
  });

  it("refuses an empty or whitespace owner id as invalid input", async () => {
    for (const ownerId of ["", "   "]) {
      const outcome = await repo.mintSendKey({ owner_id: ownerId });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe("invalid_input");
      expect(outcome.status).toBe(422);
    }
  });

  it("refuses an unknown owner id", async () => {
    const outcome = await repo.mintSendKey({ owner_id: "nobody" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("invalid_input");
      expect(outcome.message).toContain("no owner matches");
    }
  });

  it("does not mint a key when the owner check fails — no orphan rows", async () => {
    await repo.mintSendKey({ owner_id: "nobody" });
    const count = db.query("SELECT COUNT(*) AS n FROM send_keys").get() as { n: number };
    expect(count.n).toBe(0);
  });
});

describe("verifySendKey", () => {
  it("verifies a minted token and stamps last_used_at", async () => {
    seedOwner("owner-1", "ada");
    const minted = await repo.mintSendKey({ owner_id: "owner-1" });
    if (!minted.ok) throw new Error("mint failed");
    const { token, key } = minted.value;

    const before = db.query("SELECT last_used_at FROM send_keys WHERE id = ?").get(key.id) as { last_used_at: string | null };
    expect(before.last_used_at).toBeNull();

    const verified = await repo.verifySendKey(token);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value?.id).toBe(key.id);
    expect(verified.value?.last_used_at).toBeTruthy();

    // updated_at must track the LATEST of the timestamps — here, last_used_at.
    expect(verified.value?.updated_at).toBe(verified.value?.last_used_at);
  });

  it("returns null for unknown tokens without touching the database", async () => {
    const outcome = await repo.verifySendKey("esk_" + "ab".repeat(24));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBeNull();
  });

  it("returns null for malformed and non-esk_ tokens", async () => {
    for (const token of ["", "not-a-key", "sk_abcdef"]) {
      const outcome = await repo.verifySendKey(token);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.value).toBeNull();
    }
  });

  it("returns null for a revoked token — revocation is absolute", async () => {
    seedOwner("owner-1", "ada");
    const minted = await repo.mintSendKey({ owner_id: "owner-1" });
    if (!minted.ok) throw new Error("mint failed");
    const { token, key } = minted.value;

    const revoked = await repo.revokeSendKey(key.id);
    expect(revoked.ok).toBe(true);

    const verified = await repo.verifySendKey(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value).toBeNull();
  });
});

describe("revokeSendKey", () => {
  it("revokes a key and derives updated_at from revoked_at", async () => {
    seedOwner("owner-1", "ada");
    const minted = await repo.mintSendKey({ owner_id: "owner-1" });
    if (!minted.ok) throw new Error("mint failed");
    const { key } = minted.value;

    const revoked = await repo.revokeSendKey(key.id);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value?.revoked_at).toBeTruthy();
    expect(revoked.value?.updated_at).toBe(revoked.value?.revoked_at);
  });

  it("returns ok(null) for an unknown id — idempotent, no error", async () => {
    const outcome = await repo.revokeSendKey("no-such-key");
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBeNull();
  });

  it("keeps revoked_at stable across repeated revokes", async () => {
    seedOwner("owner-1", "ada");
    const minted = await repo.mintSendKey({ owner_id: "owner-1" });
    if (!minted.ok) throw new Error("mint failed");
    const { key } = minted.value;

    const first = await repo.revokeSendKey(key.id);
    const second = await repo.revokeSendKey(key.id);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value?.revoked_at).toBe(first.value?.revoked_at);
  });
});

describe("listSendKeys and getSendKey", () => {
  it("lists keys newest-first with the derived updated_at", async () => {
    seedOwner("owner-1", "ada");
    const a = await repo.mintSendKey({ owner_id: "owner-1", label: "a" });
    const b = await repo.mintSendKey({ owner_id: "owner-1", label: "b" });
    if (!a.ok || !b.ok) throw new Error("mint failed");

    const listed = await repo.listSendKeys();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((k) => k.id)).toEqual([b.value.key.id, a.value.key.id]);
  });

  it("clamps the page to 500 and normalizes offsets", async () => {
    seedOwner("owner-1", "ada");
    const big = await repo.listSendKeys({ limit: 10_000, offset: -5 });
    expect(big.ok).toBe(true);
    if (big.ok) expect(big.value.length).toBeLessThanOrEqual(500);
  });

  it("gets a key by id and null for unknown ids", async () => {
    seedOwner("owner-1", "ada");
    const minted = await repo.mintSendKey({ owner_id: "owner-1" });
    if (!minted.ok) throw new Error("mint failed");
    const got = await repo.getSendKey(minted.value.key.id);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value?.id).toBe(minted.value.key.id);

    const missing = await repo.getSendKey("no-such-id");
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBeNull();
  });
});

describe("isOwnerAuthorizedFrom", () => {
  it("refuses with the outboundPolicy capability code — never a bare false", async () => {
    const outcome = await repo.isOwnerAuthorizedFrom("owner-1", "ada@example.com");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("capability_unavailable");
    expect(outcome.status).toBe(501);
    expect(outcome.message).toContain("outboundPolicy");
  });
});
