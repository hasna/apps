/**
 * T11 — end-to-end integration matrix (plan 8022d27f, todos 69d59509).
 *
 * The acceptance gate for T6–T9 over the REAL user-visible path. Three deployment
 * cells of the skills runtime, each exercising corpus write through
 * writeCorpusSkill and registry sync through reconcileRegistry:
 *
 *   (a) localFolder    — the local corpus is the runtime. writeCorpusSkill
 *                        (T8 invariant: verbatim bytes, idempotent rewrite) and
 *                        reconcileRegistry (T9: fail-closed without a client,
 *                        write-free dry-run, convergence into the corpus). The
 *                        sync lane targets a bounded instance started by the
 *                        harness, because the T9 surface's remote IS a hosted
 *                        instance — the cell under test is the local side.
 *   (b) hostedSqlite   — the shipped server (startSkillsServer — the exact path
 *                        the deployed bin runs) on a scratch SQLite file, over
 *                        real HTTP: authenticated list/publish/pull/bundle,
 *                        tampered-bundle rejection, revision 409 (T8),
 *                        pin/tag round-trip (T6/T7), cloud sync convergence +
 *                        dry-run (T9), restart durability, unconfigured-client
 *                        fail-closed.
 *   (c) hostedPostgres — the identical lane set on a scratch PostgreSQL
 *                        database. The backend is selected by a measured gate:
 *                        HASNA_SKILLS_TEST_DATABASE_URL when set, else a
 *                        credential-free local-trust probe on 127.0.0.1:5432.
 *                        When no reachable instance exists the cell is SKIPPED
 *                        WITH EVIDENCE — never claimed covered.
 *
 * Measured reality the lanes encode (probed on main, 2026-08-18):
 *   - The merged hosted listing includes the statically bundled official corpus
 *     (86 entries in a source checkout). Those rows carry no bundle digest, so
 *     reconcile classifies every one of them "remote-only / skip — no bundle
 *     digest; verified pulls only". They are NEVER pulled and NEVER errors.
 *     Assertions are therefore entry-based, never absolute counts.
 *   - The verified pull unpacks the downloaded bundle, so a matrix bundle must
 *     be a real gzipped tar (packSkillBundle — the `skills push` path), not a
 *     bare gzip.
 *   - RemoteSkillsClient.listSkills() returns the parsed body without a status
 *     gate; the fail-closed gate lives in the sync surface
 *     (reconcileRegistry refuses a non-array listing). The lane asserts both:
 *     the 401 body is never an array, and reconcile rejects.
 *
 * Every server is started bounded (ephemeral port on 127.0.0.1) and torn down;
 * every store is a scratch temp directory or a scratch database, dropped
 * afterwards. All API keys, signing keys and manifests are synthetic test
 * values.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { PULL_MARKER_FILE } from "../lib/pull.js";
import { listPortableSkillMetas, writeCorpusSkill } from "../lib/portable-skills.js";
import { ReconcileRegistryError, reconcileRegistry, SYNC_CURSOR_FILE } from "../lib/registry-reconcile.js";
import { ownBytes, packSkillBundle, sha256Hex } from "../lib/skill-bundle.js";
import { publicPrincipal } from "./auth.js";
import { startSkillsServer } from "./app.js";
import { runMigrations } from "./migrate.js";
import { PostgresSkillsStore } from "./store.js";
import { SqliteSkillsStore } from "./sqlite-store.js";
import type { ApiPrincipal, SkillsProductStore } from "./types.js";

useDefaultTestTimeout();

// ---------------------------------------------------------------------------
// Synthetic test identity. Never a real credential: this token exists only in
// the scratch store each cell creates, and the signing key is a literal marker
// that authenticates nothing outside this suite.
// ---------------------------------------------------------------------------
const TOKEN = `sk_matrix_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const SIGNING_KEY = "matrix-test-signing-key-synthetic-only";
const PRINCIPAL: ApiPrincipal = publicPrincipal({
  orgId: "org_matrix",
  orgSlug: "org-matrix",
  orgName: "Matrix Org",
  userId: "user_matrix",
  email: "matrix@test.invalid",
  apiKeyId: "key_matrix",
});

const TEST_DATABASE_URL_ENV = "HASNA_SKILLS_TEST_DATABASE_URL";

function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function uniqueSlug(kind: string): string {
  return `matrix-${kind}-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function skillMarkdown(slug: string, body: string): string {
  return `---\nname: ${slug}\ndescription: matrix lane skill\n---\n\n# ${slug}\n\n${body}`;
}

/** A real gzipped tar of a scratch skill directory — the `skills push` path. */
function packRealSkill(slug: string, md: string): { bytes: Uint8Array; sha256: string } {
  const dir = scratchDir("skills-e2e-pack-");
  try {
    writeFileSync(join(dir, "SKILL.md"), md);
    const packed = packSkillBundle(dir);
    return { bytes: packed.bytes, sha256: packed.sha256 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Bounded server: the shipped entry path (startSkillsServer — the same code the
// deployed skills-server bin runs), bound to an ephemeral port and stopped by
// the caller. The client and every assertion then travel real HTTP.
// ---------------------------------------------------------------------------
async function startBoundedServer(
  store: SkillsProductStore,
  signing: boolean,
): Promise<{ server: Bun.Server<undefined>; apiUrl: string }> {
  const server = await startSkillsServer({
    store,
    config: {
      host: "127.0.0.1",
      port: 0,
      ...(signing ? { bundleSigningKey: SIGNING_KEY } : {}),
    },
  });
  return { server, apiUrl: `http://127.0.0.1:${server.port}` };
}

// ---------------------------------------------------------------------------
// Backend gate — postgres. The established gate is HASNA_SKILLS_TEST_DATABASE_URL;
// when it is absent, a credential-free local-trust probe on 127.0.0.1:5432 is
// attempted (measured reachable on the fleet stations that run a local cluster).
// The probe is a full trial: connect, create a scratch database, drop it. A
// backend that cannot complete the trial is SKIPPED WITH EVIDENCE, never used.
// ---------------------------------------------------------------------------
type AdminSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  unsafe(query: string, ...params: unknown[]): Promise<unknown>;
  close?: () => Promise<void>;
};

async function withAdminSql<T>(url: string, fn: (sql: AdminSql) => Promise<T>): Promise<T> {
  const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => AdminSql };
  const sql = new bunWithSql.SQL(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.close?.();
  }
}

function withDatabaseName(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** A postgres URL is a credential; never render it into test output. */
function redactedUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

type PostgresGate = { ok: true; adminUrl: string; evidence: string } | { ok: false; reason: string };

async function trialDatabase(adminUrl: string): Promise<boolean> {
  const database = `skills_matrix_gate_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    await withAdminSql(adminUrl, async (sql) => {
      await sql.unsafe(`CREATE DATABASE "${database}"`);
    });
    await withAdminSql(withDatabaseName(adminUrl, database), async (sql) => {
      await sql`SELECT 1`;
    });
    await withAdminSql(adminUrl, async (sql) => {
      await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    });
    return true;
  } catch {
    // Best-effort cleanup so a half-created scratch database never survives a
    // failed gate probe; the reason is reported by the caller either way.
    try {
      await withAdminSql(adminUrl, async (sql) => {
        await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      });
    } catch {
      // Nothing more to do.
    }
    return false;
  }
}

async function resolvePostgresGate(): Promise<PostgresGate> {
  const envUrl = process.env[TEST_DATABASE_URL_ENV]?.trim();
  if (envUrl) {
    if (await trialDatabase(envUrl)) {
      return { ok: true, adminUrl: envUrl, evidence: `${TEST_DATABASE_URL_ENV} set and reachable` };
    }
    return {
      ok: false,
      reason: `${TEST_DATABASE_URL_ENV} is set but a scratch database could not be created/dropped (${redactedUrl(envUrl)})`,
    };
  }

  // Credential-free local-trust probe. Candidate names cover the common station
  // roles; the probe itself decides (a dead candidate simply does not connect).
  const candidates = [...new Set([process.env.USER, process.env.LOGNAME, "hasna"].filter(Boolean))];
  for (const user of candidates) {
    const url = `postgres://${encodeURIComponent(user as string)}@127.0.0.1:5432/postgres`;
    if (await trialDatabase(url)) {
      return {
        ok: true,
        adminUrl: url,
        evidence: `credential-free local-trust probe succeeded on 127.0.0.1:5432 as user '${user as string}'`,
      };
    }
  }
  return {
    ok: false,
    reason: `${TEST_DATABASE_URL_ENV} is not set and no credential-free postgres on 127.0.0.1:5432 accepted a scratch-database trial (candidates: ${candidates.join(", ") || "none"})`,
  };
}

// ---------------------------------------------------------------------------
// Backend fixtures. create() returns a seeded store plus a reopen() for the
// restart-durability lane and a close() that tears everything down, including
// the scratch database.
// ---------------------------------------------------------------------------
interface HostedCellHandle {
  kind: "sqlite" | "postgres";
  store: SkillsProductStore;
  reopen(): Promise<SkillsProductStore>;
  close(): Promise<void>;
  /** Corrupt the stored blob of one bundle, out of band — storage drift. */
  corruptBundle(sha256: string, replacement: Uint8Array): Promise<void>;
}

interface HostedBackend {
  readonly kind: "sqlite" | "postgres";
  readonly gate: string;
  create(): Promise<HostedCellHandle>;
}

async function createSqliteCell(): Promise<HostedCellHandle> {
  const dir = scratchDir("skills-e2e-sqlite-");
  const path = join(dir, "server.db");
  const store = new SqliteSkillsStore(path);
  await store.ensureBootstrapApiKey(TOKEN, PRINCIPAL);
  return {
    kind: "sqlite",
    store,
    async reopen() {
      const reopened = new SqliteSkillsStore(path);
      await reopened.ensureBootstrapApiKey(TOKEN, PRINCIPAL);
      return reopened;
    },
    async close() {
      await store.close();
      rmSync(dir, { recursive: true, force: true });
    },
    async corruptBundle(sha256: string, replacement: Uint8Array) {
      const db = new Database(path);
      try {
        db.run("UPDATE skills_bundles SET body_blob = ? WHERE org_id = ? AND sha256 = ?", [
          replacement,
          PRINCIPAL.orgId,
          sha256,
        ]);
      } finally {
        db.close();
      }
    },
  };
}

function createPostgresCell(adminUrl: string): () => Promise<HostedCellHandle> {
  return async () => {
    const database = `skills_matrix_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await withAdminSql(adminUrl, async (sql) => {
      await sql.unsafe(`CREATE DATABASE "${database}"`);
    });
    const url = withDatabaseName(adminUrl, database);
    await runMigrations(url);
    const store = new PostgresSkillsStore(url);
    await store.ensureBootstrapApiKey(TOKEN, PRINCIPAL);
    return {
      kind: "postgres",
      store,
      async reopen() {
        const reopened = new PostgresSkillsStore(url);
        await reopened.ensureBootstrapApiKey(TOKEN, PRINCIPAL);
        return reopened;
      },
      async close() {
        await store.close();
        await withAdminSql(adminUrl, async (sql) => {
          await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        });
      },
      async corruptBundle(sha256: string, replacement: Uint8Array) {
        await withAdminSql(url, async (sql) => {
          await sql.unsafe("UPDATE skills_bundles SET body_blob = $1::bytea WHERE org_id = $2 AND sha256 = $3", [
            replacement,
            PRINCIPAL.orgId,
            sha256,
          ]);
        });
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Gate resolution (module scope, like the store-fixtures it mirrors).
// ---------------------------------------------------------------------------
const pgGate = await resolvePostgresGate();
const backends: HostedBackend[] = [
  { kind: "sqlite", gate: "scratch sqlite file in a temp directory", create: createSqliteCell },
];
if (pgGate.ok) {
  backends.push({ kind: "postgres", gate: pgGate.evidence, create: createPostgresCell(pgGate.adminUrl) });
} else {
  console.log(`[e2e-matrix] hostedPostgres cell: SKIPPED-WITH-EVIDENCE — gate: ${pgGate.reason}`);
}

interface HostedCell {
  kind: "sqlite" | "postgres";
  apiUrl: string;
  client: RemoteSkillsClient;
}

async function withHostedServer(
  handle: HostedCellHandle,
  fn: (cell: HostedCell) => Promise<void>,
): Promise<void> {
  const { server, apiUrl } = await startBoundedServer(handle.store, true);
  try {
    await fn({ kind: handle.kind, apiUrl, client: new RemoteSkillsClient(TOKEN, apiUrl) });
  } finally {
    server.stop(true);
  }
}

/** Publish one real packed skill over HTTP; returns its etag and bundle sha. */
async function publishLaneSkill(
  client: RemoteSkillsClient,
  slug: string,
  md: string,
  tag?: string,
): Promise<{ etag: string; bundleSha256: string; bundle: Uint8Array }> {
  const packed = packRealSkill(slug, md);
  const manifest: Record<string, unknown> = {
    slug,
    description: `matrix lane skill ${slug}`,
    skillMd: md,
    version: "1.0.0",
    bundleSha256: packed.sha256,
    ...(tag ? { tags: [tag] } : {}),
  };
  const response = await client.publishSkill(manifest, packed.bytes);
  expect(response.status).toBe(201);
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  return { etag: etag as string, bundleSha256: packed.sha256, bundle: packed.bytes };
}

function syncClient(client: RemoteSkillsClient): RemoteSkillsClient {
  return client;
}

// ---------------------------------------------------------------------------
// Cells (b) and (c) — hosted instance on sqlite / postgres. Identical lanes.
// ---------------------------------------------------------------------------
for (const backend of backends) {
  describe(`hosted ${backend.kind} cell (${backend.gate})`, () => {
    test("authenticated list / publish / pull / bundle over real HTTP", async () => {
      const handle = await backend.create();
      try {
        await withHostedServer(handle, async ({ client }) => {
          const slug = uniqueSlug(backend.kind);
          const md = skillMarkdown(slug, "authenticated lanes");
          const { etag, bundleSha256, bundle } = await publishLaneSkill(client, slug, md);

          // list
          const list = await client.listSkills();
          const row = list.find((entry: Record<string, unknown>) => entry.slug === slug);
          expect(row).toBeTruthy();
          expect(row?.version).toBe("1.0.0");

          // metadata: SKILL.md served byte-for-byte (the pull-proves-revision path)
          const servedMd = await client.getSkillMd(slug);
          expect(servedMd).toBe(md);

          // bundle: digest must match what was published, real gzip magic, revision header
          const downloaded = await client.downloadSkillBundle(slug);
          expect(downloaded.status).toBe(200);
          expect(downloaded.headers.get("x-skill-bundle-sha256")).toBe(bundleSha256);
          const servedRevision = downloaded.headers.get("x-skill-revision-id");
          expect(servedRevision).toBeTruthy();
          const bytes = ownBytes(new Uint8Array(await downloaded.arrayBuffer()));
          expect(sha256Of(bytes)).toBe(bundleSha256);
          expect(bytes[0]).toBe(0x1f);
          expect(bytes[1]).toBe(0x8b);

          // the response etag is the revision id, quoted per RFC 9110
          expect(downloaded.headers.get("etag")).toBe(`"${servedRevision}"`);
          expect(etag).toBe(`"${servedRevision}"`);

          // corpus write through writeCorpusSkill: the pulled skill lands verbatim
          const root = scratchDir("skills-e2e-pullwrite-");
          try {
            const write = writeCorpusSkill({ name: slug, skillMd: md }, { rootDir: root });
            expect(write.created).toBe(true);
            expect(readFileSync(join(root, slug, "SKILL.md"), "utf8")).toBe(md);
            expect(sha256Of(bundle)).toBe(bundleSha256);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        });
      } finally {
        await handle.close();
      }
    });

    test("tampered bundle is rejected, never served (digest lane)", async () => {
      const handle = await backend.create();
      try {
        await withHostedServer(handle, async ({ client, apiUrl }) => {
          const slug = uniqueSlug(backend.kind);
          const { bundleSha256 } = await publishLaneSkill(client, slug, skillMarkdown(slug, "tamper lane"));

          // Control first: the bytes served before tampering hash to the published digest.
          const before = await client.downloadSkillBundle(slug);
          expect(before.headers.get("x-skill-bundle-sha256")).toBe(bundleSha256);
          // The signing key is configured, so the server signs the exact bytes it serves.
          expect(before.headers.get("x-skill-bundle-signature")).toBeTruthy();

          // Corrupt the stored blob out of band — a bad restore, an S3 object
          // replaced by something else. Silent without the read-time digest check.
          await handle.corruptBundle(bundleSha256, ownBytes(new TextEncoder().encode("tampered")));

          const after = await fetch(`${apiUrl}/api/v1/skills/${slug}/bundle`, {
            headers: { Authorization: `Bearer ${TOKEN}` },
          });
          expect(after.status).toBeGreaterThanOrEqual(400);
          const body = (await after.json()) as { code?: string };
          expect(body.code).toBe("BUNDLE_DIGEST_DRIFT");
        });
      } finally {
        await handle.close();
      }
    });

    test("revision 409 — optimistic concurrency (T8)", async () => {
      const handle = await backend.create();
      try {
        await withHostedServer(handle, async ({ client, apiUrl }) => {
          const slug = uniqueSlug(backend.kind);
          const v1 = packRealSkill(slug, skillMarkdown(slug, "v1"));
          const v2 = packRealSkill(slug, skillMarkdown(slug, "v2"));

          // Versions are immutable (hasna/apps#1630): different bytes travel under a new version.
          const manifestFor = (bytes: Uint8Array, md: string, version = "1.0.0") => ({
            slug,
            description: "rev",
            skillMd: md,
            version,
            bundleSha256: sha256Of(bytes),
          });

          const first = await client.publishSkill(manifestFor(v1.bytes, skillMarkdown(slug, "v1")), v1.bytes);
          expect(first.status).toBe(201);
          const etag1 = first.headers.get("etag") as string;

          // A re-publish of a live slug without If-Match is refused — never a silent overwrite.
          const noGuard = await client.publishSkill(manifestFor(v1.bytes, skillMarkdown(slug, "v1")), v1.bytes);
          expect(noGuard.status).toBe(409);
          expect(((await noGuard.json()) as { code?: string }).code).toBe("REVISION_CONFLICT");

          // A stale If-Match (well-formed 64-hex revision that is not current) is
          // refused with the current revision named. A malformed etag is a 400
          // shape error and is covered by the server's own route tests.
          const staleEtag = `"${"a".repeat(64)}"`;
          const stale = await client.publishSkill(manifestFor(v2.bytes, skillMarkdown(slug, "v2"), "1.0.1"), v2.bytes, staleEtag);
          expect(stale.status).toBe(409);
          const staleBody = (await stale.json()) as { code?: string; currentRevisionId?: string };
          expect(staleBody.code).toBe("REVISION_CONFLICT");
          expect(staleBody.currentRevisionId).toBeTruthy();

          // The current revision etag unlocks the write; the revision advances.
          const guarded = await client.publishSkill(manifestFor(v2.bytes, skillMarkdown(slug, "v2"), "1.0.1"), v2.bytes, etag1);
          expect(guarded.status).toBe(201);
          const etag2 = guarded.headers.get("etag") as string;
          expect(etag2).not.toBe(etag1);

          // The read surface agrees the revision advanced.
          const listed = (await client.listSkills()).find((r: Record<string, unknown>) => r.slug === slug);
          expect(listed?.revisionId).toBe(etag2.slice(1, -1));

          // T8's update contract over HTTP, measured on main:
          //   - PUT against a slug this org never published is 404 — a guarded write
          //     must not mint a bundle-less row from a typo'd name.
          //   - PUT against a live row with a stale guard is 409 REVISION_CONFLICT.
          //   - PUT against a live row with the current guard lands and advances the
          //     revision.
          const ghost = uniqueSlug("ghost");
          const putGhost = await fetch(`${apiUrl}/api/v1/skills/${ghost}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${TOKEN}`, "If-Match": etag1, "Content-Type": "application/json" },
            body: JSON.stringify({ description: "must not exist" }),
          });
          expect(putGhost.status).toBe(404);
          expect(((await putGhost.json()) as { code?: string }).code).toBe("SKILL_NOT_FOUND");

          const putStale = await fetch(`${apiUrl}/api/v1/skills/${slug}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${TOKEN}`, "If-Match": `"${"b".repeat(64)}"`, "Content-Type": "application/json" },
            body: JSON.stringify({ description: "stale guard" }),
          });
          expect(putStale.status).toBe(409);
          const putStaleBody = (await putStale.json()) as { code?: string; currentRevisionId?: string };
          expect(putStaleBody.code).toBe("REVISION_CONFLICT");
          expect(putStaleBody.currentRevisionId).toBe(etag2.slice(1, -1));

          const putCurrent = await fetch(`${apiUrl}/api/v1/skills/${slug}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${TOKEN}`, "If-Match": etag2, "Content-Type": "application/json" },
            body: JSON.stringify({ description: "current guard" }),
          });
          expect(putCurrent.status).toBe(200);
          const putCurrentBody = (await putCurrent.json()) as { revisionId?: string; revisionNumber?: number };
          expect(putCurrentBody.revisionId).toBeTruthy();
          expect(putCurrentBody.revisionId).not.toBe(etag2.slice(1, -1));
          expect(putCurrentBody.revisionNumber).toBe(3);
        });
      } finally {
        await handle.close();
      }
    });

    test("pin/tag round-trip (T6/T7)", async () => {
      const handle = await backend.create();
      try {
        await withHostedServer(handle, async ({ client }) => {
          const slug = uniqueSlug(backend.kind);
          const tag = `matrix-tag-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
          await publishLaneSkill(client, slug, skillMarkdown(slug, "pin/tag lane"), tag);

          const pinned = await client.pin(slug, { source: "matrix" });
          expect(pinned.slug).toBe(slug);
          const pins = await client.listPins();
          expect(pins.some((pin) => pin.slug === slug)).toBe(true);

          const tags = await client.listTags();
          expect(tags).toContain(tag);
          const byTag = await client.skillsByTag(tag);
          expect(byTag.some((skill) => skill.slug === slug)).toBe(true);

          expect(await client.unpin(slug)).toBe(true);
          expect((await client.listPins()).some((pin) => pin.slug === slug)).toBe(false);
        });
      } finally {
        await handle.close();
      }
    });

    test("cloud sync convergence + dry-run (T9)", async () => {
      const handle = await backend.create();
      try {
        await withHostedServer(handle, async ({ client }) => {
          const root = scratchDir("skills-e2e-corpus-");
          try {
            const localSlug = uniqueSlug("local");
            const remoteSlug = uniqueSlug("remote");
            const remoteMd = skillMarkdown(remoteSlug, "remote-only, must be pulled verbatim");
            await publishLaneSkill(client, remoteSlug, remoteMd);
            const localWrite = writeCorpusSkill(
              { name: localSlug, skillMd: skillMarkdown(localSlug, "local-only, must be pushed") },
              { rootDir: root },
            );
            expect(localWrite.created).toBe(true);

            // Dry run: plans both directions, writes nothing, and the bundled
            // official corpus (digestless) is skipped — never pulled, never an error.
            const dry = await reconcileRegistry({ rootDir: root, client, all: true, dryRun: true, signingKey: SIGNING_KEY });
            expect(dry.dryRun).toBe(true);
            expect(dry.migrationPending).toBe(false);
            expect(dry.summary.local).toBe(1);
            expect(dry.summary.remote).toBeGreaterThanOrEqual(1);
            const dryLocal = dry.skills.find((entry) => entry.slug === localSlug);
            const dryRemote = dry.skills.find((entry) => entry.slug === remoteSlug);
            expect(dryLocal?.state).toBe("local-only");
            expect(dryLocal?.action).toBe("push");
            expect(dryRemote?.state).toBe("remote-only");
            expect(dryRemote?.action).toBe("pull");
            for (const entry of dry.skills) {
              if (entry.slug === localSlug || entry.slug === remoteSlug) continue;
              expect(entry.state).toBe("remote-only");
              expect(entry.action).toBe("skip");
              expect(entry.reason).toMatch(/no bundle digest/);
            }
            expect(existsSync(join(root, SYNC_CURSOR_FILE))).toBe(false);

            // Real run: pushes the local-only skill and pulls the remote-only skill.
            const real = await reconcileRegistry({ rootDir: root, client, all: true, signingKey: SIGNING_KEY });
            expect(real.dryRun).toBe(false);
            expect(real.summary.pushed).toBe(1);
            expect(real.summary.pulled).toBe(1);
            expect(real.summary.errors).toBe(0);
            expect(real.cursor?.runCount).toBe(1);
            expect(existsSync(join(root, SYNC_CURSOR_FILE))).toBe(true);

            // The pull landed byte-for-byte — a pull must prove which revision it
            // installed, which requires the installed bytes to BE the hashed bytes.
            expect(readFileSync(join(root, remoteSlug, "SKILL.md"), "utf8")).toBe(remoteMd);
            expect(existsSync(join(root, remoteSlug, PULL_MARKER_FILE))).toBe(true);

            // The push is visible through the hosted list surface.
            const listed = await client.listSkills();
            expect(listed.some((r: Record<string, unknown>) => r.slug === localSlug)).toBe(true);

            // Second run converges: the matrix skills are in sync, nothing to move.
            const settled = await reconcileRegistry({ rootDir: root, client, all: true, signingKey: SIGNING_KEY });
            expect(settled.summary.inSync).toBeGreaterThanOrEqual(2);
            expect(settled.summary.pushed).toBe(0);
            expect(settled.summary.pulled).toBe(0);
            expect(settled.summary.errors).toBe(0);
            expect(settled.cursor?.runCount).toBe(2);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        });
      } finally {
        await handle.close();
      }
    });

    test("restart durability — rows, revisions and pins survive a restart", async () => {
      const handle = await backend.create();
      const first = await startBoundedServer(handle.store, true);
      const slug = uniqueSlug(backend.kind);
      let etagBefore: string;
      try {
        const client = new RemoteSkillsClient(TOKEN, first.apiUrl);
        etagBefore = (await publishLaneSkill(client, slug, skillMarkdown(slug, "durable"))).etag;
        await client.pin(slug, { source: "restart" });
        expect((await client.listPins()).some((pin) => pin.slug === slug)).toBe(true);
      } finally {
        first.server.stop(true);
      }
      await handle.store.close?.();

      // "Restart": reopen the same store, serve it again.
      const reopenedStore = await handle.reopen();
      const second = await startBoundedServer(reopenedStore, true);
      try {
        const client = new RemoteSkillsClient(TOKEN, second.apiUrl);
        const listed = await client.listSkills();
        expect(listed.some((r: Record<string, unknown>) => r.slug === slug)).toBe(true);
        expect((await client.listPins()).some((pin) => pin.slug === slug)).toBe(true);
        const fetched = await fetch(`${second.apiUrl}/api/v1/skills/${slug}`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        expect(fetched.status).toBe(200);
        expect(fetched.headers.get("etag")).toBe(etagBefore);
      } finally {
        second.server.stop(true);
        await reopenedStore.close?.();
      }
      await handle.close();
    });

    test("unconfigured client fails closed", async () => {
      const handle = await backend.create();
      try {
        await withHostedServer(handle, async ({ apiUrl }) => {
          // No Authorization header: refused, with the fail-closed code.
          const anon = await fetch(`${apiUrl}/api/v1/skills`);
          expect(anon.status).toBe(401);
          expect(((await anon.json()) as { code?: string }).code).toBe("AUTH_REQUIRED");

          // A wrong key: the 401 body is never an array (an empty listing would
          // read as "no skills"), and the sync surface refuses it outright.
          const impostor = new RemoteSkillsClient("sk_matrix_wrong_key", apiUrl);
          const bad = await impostor.listSkills();
          expect(Array.isArray(bad)).toBe(false);
          const root = scratchDir("skills-e2e-failclosed-");
          try {
            await expect(reconcileRegistry({ rootDir: root, client: impostor })).rejects.toThrow(/Registry listing failed/);
            // The sync surface with no client at all: the same fail-closed refusal.
            await expect(reconcileRegistry({ rootDir: root, client: null })).rejects.toThrow(/No API key configured/);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        });
      } finally {
        await handle.close();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Cell (a) — local folder. The local corpus is the runtime; the T9 sync lanes
// target a bounded instance started by the harness as the remote.
// ---------------------------------------------------------------------------
describe("localFolder cell (corpus write through writeCorpusSkill, registry sync through reconcileRegistry)", () => {
  test("corpus write through writeCorpusSkill — T8 invariant: verbatim bytes, idempotent", async () => {
    const root = scratchDir("skills-e2e-localwrite-");
    try {
      const slug = uniqueSlug("write");
      const md = skillMarkdown(slug, "first body — exactly these bytes, nothing appended");

      const first = writeCorpusSkill({ name: slug, skillMd: md }, { rootDir: root });
      expect(first.created).toBe(true);
      expect(readFileSync(join(root, slug, "SKILL.md"), "utf8")).toBe(md);
      expect(existsSync(join(root, slug, "skill.json"))).toBe(true);

      // Idempotent: same bytes in, byte-identical files out, nothing new created.
      const second = writeCorpusSkill({ name: slug, skillMd: md }, { rootDir: root });
      expect(second.created).toBe(false);
      expect(readFileSync(join(root, slug, "SKILL.md"), "utf8")).toBe(md);
      const entries = readdirSync(join(root, slug)).sort();
      expect(entries).toEqual(["SKILL.md", "skill.json"]);

      // The corpus is a first-class registry source: the written skill surfaces
      // through the portable-metadata listing with no further step.
      const metas = listPortableSkillMetas({ rootDir: root });
      expect(metas.some((meta) => meta.name === slug)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("registry sync fails closed without a configured client", async () => {
    const root = scratchDir("skills-e2e-syncfail-");
    try {
      await expect(reconcileRegistry({ rootDir: root, client: null })).rejects.toThrow(ReconcileRegistryError);
      await expect(reconcileRegistry({ rootDir: root, client: null })).rejects.toThrow(/No API key configured/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dry-run plans the sync without writing anything (T9)", async () => {
    const handle = await createSqliteCell();
    try {
      await withHostedServer(handle, async ({ client }) => {
        const root = scratchDir("skills-e2e-dryrun-");
        try {
          const localSlug = uniqueSlug("drylocal");
          writeCorpusSkill({ name: localSlug, skillMd: skillMarkdown(localSlug, "planned, not pushed") }, { rootDir: root });
          const remoteSlug = uniqueSlug("dryremote");
          await publishLaneSkill(client, remoteSlug, skillMarkdown(remoteSlug, "planned, not pulled"));

          const before = readdirSync(root).sort();
          const plan = await reconcileRegistry({ rootDir: root, client, all: true, dryRun: true, signingKey: SIGNING_KEY });
          expect(plan.summary.local).toBe(1);
          expect(plan.summary.remote).toBeGreaterThanOrEqual(1);
          expect(plan.skills.find((e) => e.slug === localSlug)?.action).toBe("push");
          expect(plan.skills.find((e) => e.slug === remoteSlug)?.action).toBe("pull");
          expect(plan.cursor).toBeUndefined();

          // Write-free: the corpus root gained nothing (no cursor, no pulled skill).
          expect(readdirSync(root).sort()).toEqual(before);
          expect(existsSync(join(root, SYNC_CURSOR_FILE))).toBe(false);
          expect(existsSync(join(root, remoteSlug))).toBe(false);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    } finally {
      await handle.close();
    }
  });

  test("convergence — local-only pushed, remote-only pulled verbatim into the local corpus", async () => {
    const handle = await createSqliteCell();
    try {
      await withHostedServer(handle, async ({ client }) => {
        const root = scratchDir("skills-e2e-converge-");
        try {
          const localSlug = uniqueSlug("convergelocal");
          const remoteSlug = uniqueSlug("convergeremote");
          const remoteMd = skillMarkdown(remoteSlug, "pulled verbatim across the wire");
          writeCorpusSkill({ name: localSlug, skillMd: skillMarkdown(localSlug, "pushed across the wire") }, { rootDir: root });
          await publishLaneSkill(client, remoteSlug, remoteMd);

          const result = await reconcileRegistry({ rootDir: root, client, all: true, signingKey: SIGNING_KEY });
          expect(result.summary.errors).toBe(0);
          expect(result.summary.pushed).toBe(1);
          expect(result.summary.pulled).toBe(1);

          expect(readFileSync(join(root, remoteSlug, "SKILL.md"), "utf8")).toBe(remoteMd);
          expect(existsSync(join(root, remoteSlug, PULL_MARKER_FILE))).toBe(true);
          expect((await client.listSkills()).some((r: Record<string, unknown>) => r.slug === localSlug)).toBe(true);
          expect(existsSync(join(root, SYNC_CURSOR_FILE))).toBe(true);

          const settled = await reconcileRegistry({ rootDir: root, client, all: true, signingKey: SIGNING_KEY });
          expect(settled.summary.inSync).toBeGreaterThanOrEqual(2);
          expect(settled.summary.pushed).toBe(0);
          expect(settled.summary.pulled).toBe(0);
          expect(settled.summary.errors).toBe(0);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    } finally {
      await handle.close();
    }
  });
});
