/**
 * Test gap coverage for src/lib/browser-ingest-tokens.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The browser ingest token lifecycle (create/validate/revoke/touch + origin
 * allowlisting) had no sibling test. These tests pin the token shape, the
 * sha256-at-rest hash, the origin allowlist semantics (exact origin match,
 * missing-origin denial, cross-project isolation) and the revoke-once
 * contract against a real in-memory SQLite catalog.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { createTestDb } from "../db/index.ts";
import {
  createBrowserIngestToken,
  listBrowserIngestTokens,
  normalizeAllowedOrigins,
  revokeBrowserIngestToken,
  touchBrowserIngestToken,
  validateBrowserIngestToken,
} from "./browser-ingest-tokens.ts";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Ensure the owning project row exists (browser_ingest_tokens FK). */
function withProject(
  db: ReturnType<typeof createTestDb>,
  projectId: string,
): void {
  db.prepare("INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)").run(
    projectId,
    projectId,
  );
}

/** Test db with the two projects used across the token lifecycle tests. */
function tokenTestDb(): ReturnType<typeof createTestDb> {
  const db = createTestDb();
  withProject(db, "proj-1");
  withProject(db, "proj-other");
  return db;
}

describe("createBrowserIngestToken", () => {
  it("creates a bearer-shaped token with a stored hash, never the token itself", () => {
    const db = tokenTestDb();
    withProject(db, "proj-1");
    const created = createBrowserIngestToken(db, "proj-1", { name: "site" });
    expect(created.token.startsWith("olb_")).toBe(true);
    expect(created.token).toHaveLength(4 + 64); // olb_ + 64 hex chars
    expect(created.token_prefix).toBe(created.token.slice(0, 12));
    expect(created.project_id).toBe("proj-1");
    expect(created.name).toBe("site");
    expect(created.enabled).toBe(1);
    expect(created.last_used_at).toBeNull();

    const stored = db
      .prepare("SELECT token_hash, allowed_origins FROM browser_ingest_tokens WHERE id = ?")
      .get(created.id) as { token_hash: string; allowed_origins: string | null };
    expect(stored.token_hash).toBe(hashToken(created.token));
    // The raw token must never be persisted.
    expect(stored.token_hash).not.toContain(created.token);
  });

  it("stores normalized allowed origins and null when none are given", () => {
    const db = tokenTestDb();
    withProject(db, "proj-1");
    const withOrigins = createBrowserIngestToken(db, "proj-1", {
      allowed_origins: [
        "https://app.example.com",
        "https://app.example.com/",
        "HTTPS://APP.EXAMPLE.COM",
      ],
    });
    const stored = db
      .prepare("SELECT allowed_origins FROM browser_ingest_tokens WHERE id = ?")
      .get(withOrigins.id) as { allowed_origins: string };
    expect(JSON.parse(stored.allowed_origins)).toEqual([
      "https://app.example.com",
    ]);

    const noOrigins = createBrowserIngestToken(db, "proj-1");
    withProject(db, "proj-1");
    const storedNone = db
      .prepare("SELECT allowed_origins FROM browser_ingest_tokens WHERE id = ?")
      .get(noOrigins.id) as { allowed_origins: string | null };
    expect(storedNone.allowed_origins).toBeNull();
  });
});

describe("validateBrowserIngestToken", () => {
  it("rejects null, non-olb_, unknown, and revoked tokens", () => {
    const db = tokenTestDb();
    const created = createBrowserIngestToken(db, "proj-1");
    expect(validateBrowserIngestToken(db, null)).toBeNull();
    expect(validateBrowserIngestToken(db, undefined)).toBeNull();
    expect(validateBrowserIngestToken(db, "wrong-prefix")).toBeNull();
    expect(validateBrowserIngestToken(db, `olb_${"0".repeat(64)}`)).toBeNull();

    revokeBrowserIngestToken(db, "proj-1", created.id);
    expect(validateBrowserIngestToken(db, created.token)).toBeNull();
  });

  it("returns the token identity for a valid token", () => {
    const db = tokenTestDb();
    const created = createBrowserIngestToken(db, "proj-1");
    const valid = validateBrowserIngestToken(db, created.token);
    expect(valid).toMatchObject({
      id: created.id,
      project_id: "proj-1",
      token_prefix: created.token.slice(0, 12),
    });
    expect(valid?.allowed_origins).toEqual([]);
  });

  it("enforces the origin allowlist: no origin or non-listed origin is rejected", () => {
    const db = tokenTestDb();
    const created = createBrowserIngestToken(db, "proj-1", {
      allowed_origins: ["https://app.example.com"],
    });
    // Origin header missing -> denied.
    expect(validateBrowserIngestToken(db, created.token)).toBeNull();
    expect(validateBrowserIngestToken(db, created.token, null)).toBeNull();
    // Origin not on the list -> denied.
    expect(
      validateBrowserIngestToken(db, created.token, "https://evil.example.com"),
    ).toBeNull();
    // Ports are part of the origin: same host, different port -> denied.
    expect(
      validateBrowserIngestToken(db, created.token, "https://app.example.com:8443"),
    ).toBeNull();
    // Exact origin -> allowed.
    expect(
      validateBrowserIngestToken(db, created.token, "https://app.example.com"),
    ).not.toBeNull();
  });

  it("treats an unparseable origin as a denial when an allowlist exists", () => {
    const db = tokenTestDb();
    const created = createBrowserIngestToken(db, "proj-1", {
      allowed_origins: ["https://app.example.com"],
    });
    expect(validateBrowserIngestToken(db, created.token, "not a url")).toBeNull();
  });
});

describe("revokeBrowserIngestToken", () => {
  it("revokes exactly once and only for the owning project", () => {
    const db = tokenTestDb();
    const created = createBrowserIngestToken(db, "proj-1");
    // Cross-project revoke is a no-op (returns false).
    expect(revokeBrowserIngestToken(db, "proj-other", created.id)).toBe(false);
    expect(
      validateBrowserIngestToken(db, created.token),
    ).not.toBeNull();

    expect(revokeBrowserIngestToken(db, "proj-1", created.id)).toBe(true);
    expect(revokeBrowserIngestToken(db, "proj-1", created.id)).toBe(false);
    expect(validateBrowserIngestToken(db, created.token)).toBeNull();
  });
});

describe("touchBrowserIngestToken and listBrowserIngestTokens", () => {
  it("records last_used_at on touch", () => {
    const db = tokenTestDb();
    const created = createBrowserIngestToken(db, "proj-1");
    expect(created.last_used_at).toBeNull();
    touchBrowserIngestToken(db, created.id);
    const touched = db
      .prepare("SELECT last_used_at FROM browser_ingest_tokens WHERE id = ?")
      .get(created.id) as { last_used_at: string };
    expect(touched.last_used_at).not.toBeNull();
  });

  it("lists only the project's tokens, newest first", async () => {
    const db = tokenTestDb();
    const first = createBrowserIngestToken(db, "proj-1", { name: "first" });
    // Distinct created_at timestamps make the DESC order deterministic.
    await Bun.sleep(5);
    const second = createBrowserIngestToken(db, "proj-1", { name: "second" });
    createBrowserIngestToken(db, "proj-other", { name: "other" });

    const rows = listBrowserIngestTokens(db, "proj-1");
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(rows.every((r) => r.project_id === "proj-1")).toBe(true);
    // Tokens themselves are never listed.
    expect("token" in (rows[0] ?? {})).toBe(false);
  });
});

describe("normalizeAllowedOrigins", () => {
  it("deduplicates, normalizes case/path, and drops unparseable origins", () => {
    expect(
      normalizeAllowedOrigins([
        "https://A.example.com/",
        "https://a.example.com",
        "http://b.example.com:8080",
        "garbage",
        "",
      ]),
    ).toEqual([
      "https://a.example.com",
      "http://b.example.com:8080",
    ]);
    expect(normalizeAllowedOrigins([])).toEqual([]);
  });
});
