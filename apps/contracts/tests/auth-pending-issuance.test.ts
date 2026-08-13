import { describe, expect, test } from "bun:test";
import { mintApiKey } from "../src/auth/keys";
import { ApiKeyStore, type AuthQueryClient, type Row } from "../src/auth/store";

const SIGNING = "test-signing-secret-not-a-real-credential-000";

class PendingStoreClient implements AuthQueryClient {
  private readonly rows = new Map<string, Row>();

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    if (!sql.startsWith("INSERT INTO")) return;
    const [kid, app, agent, tid, scopes, tokenHash, issuedAt, expiresAt, createdBy, revokedAt, revokedReason] = params;
    this.rows.set(String(kid), {
      kid,
      app,
      agent,
      tid,
      scopes,
      token_hash: tokenHash,
      issued_at: issuedAt,
      expires_at: expiresAt,
      created_by: createdBy,
      revoked_at: revokedAt,
      revoked_reason: revokedReason,
      last_used_at: null,
    });
  }

  async get<T extends Row>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const row = this.rows.get(String(params[0]));
    if (sql.startsWith("SELECT revoked_at")) {
      return row ? ({ revoked_at: row.revoked_at } as unknown as T) : null;
    }
    if (sql.startsWith("UPDATE") && sql.includes("SET revoked_at = NULL")) {
      if (!row || !row.revoked_at || row.revoked_reason !== params[1]) return null;
      row.revoked_at = null;
      row.revoked_reason = null;
      return { kid: row.kid } as unknown as T;
    }
    if (sql.includes("WHERE kid =")) return (row as T | undefined) ?? null;
    return null;
  }

  async many<T extends Row>(sql: string): Promise<T[]> {
    const rows = [...this.rows.values()];
    return (sql.includes("revoked_at IS NULL") ? rows.filter((row) => !row.revoked_at) : rows) as T[];
  }
}

describe("API key pending issuance lifecycle", () => {
  test("pending is denied by existing status paths until one exact activation", async () => {
    const store = new ApiKeyStore(new PendingStoreClient());
    const minted = mintApiKey({ app: "todos", scopes: ["todos:read"], signingSecret: SIGNING, agent: "alice" });

    await store.insertMintedPending(minted, "issuer", 1_700_000_000_000);
    expect(await store.status(minted.kid)).toBe("revoked");
    expect(await store.isRevoked(minted.kid)).toBe(true);
    expect(await store.statusChecker()(minted.kid)).toBe(true);
    expect(await store.list()).toEqual([]);

    expect(await store.activatePending(minted.kid)).toBe(true);
    expect(await store.activatePending(minted.kid)).toBe(false);
    expect(await store.status(minted.kid)).toBe("active");
    expect(await store.isRevoked(minted.kid)).toBe(false);
    expect(await store.statusChecker()(minted.kid)).toBe(false);
  });
});
