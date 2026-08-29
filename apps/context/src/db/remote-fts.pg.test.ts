/**
 * REAL Postgres regression coverage for full-text search on the hosted backend.
 *
 * ROOT CAUSE guarded here: SQLite FTS5 (libraries_fts, chunks_fts + triggers)
 * is built only in the local schema (database.ts). The PostgreSQL schema
 * (pg-migrations.ts) shipped NO full-text search at all, and PgAdapterAsync
 * exposed no search surface — so a hosted deployment could not search
 * libraries or chunks from the Postgres backend. The Postgres backend now
 * carries generated tsvector columns + GIN indexes (migration 15, maintained
 * automatically by the sync upsert) and PgAdapterAsync gains searchChunks /
 * searchLibraries with FTS5-equivalent prefix semantics.
 *
 * The fixtures are inserted with the same SQL the sync produces (upsertPg),
 * after runStorageMigrations — so this covers migration 15 + generated
 * columns end to end. This file deliberately mutates NO shared state: bun's
 * test runner executes every file in one process, so process.env and the
 * SQLite singleton here must stay untouched.
 *
 * Guarded by HASNA_CONTEXT_TEST_DATABASE_URL (legacy alias CONTEXT_TEST_PG_URL)
 * so the default no-Postgres lane skips it. Point that variable at a Postgres
 * DSN (e.g. postgres://hasna@127.0.0.1:5432/context_fts_port_test) and run:
 *   bun test src/db/remote-fts.pg.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { PgAdapterAsync, buildPrefixTsQuery } from "./remote-storage.js";
import {
  resolveLibraryBySlugOnBackend,
  resolveLibraryOnBackend,
  semanticSearchOnBackend,
} from "./backend-search.js";
import { runStorageMigrations } from "./storage-sync.js";

const PG_URL = process.env["HASNA_CONTEXT_TEST_DATABASE_URL"] ?? process.env["CONTEXT_TEST_PG_URL"];

describe("buildPrefixTsQuery", () => {
  test("ANDs prefix terms like the local FTS5 escapeFts", () => {
    expect(buildPrefixTsQuery("useState hooks")).toBe("useState:* & hooks:*");
    expect(buildPrefixTsQuery("React hook")).toBe("React:* & hook:*");
  });

  test("strips tsquery syntax characters", () => {
    expect(buildPrefixTsQuery("foo:bar")).toBe("foobar:*");
    expect(buildPrefixTsQuery('say "hi"')).toBe("say:* & hi:*");
    expect(buildPrefixTsQuery("a & b")).toBe("a:* & b:*");
  });

  test("returns null for empty or whitespace-only queries", () => {
    expect(buildPrefixTsQuery("")).toBeNull();
    expect(buildPrefixTsQuery("   ")).toBeNull();
  });
});

describe.skipIf(!PG_URL)("postgres full-text search parity", () => {
  let remote: PgAdapterAsync;

  beforeAll(async () => {
    remote = new PgAdapterAsync(PG_URL!);
    // Start from fresh tables for this run (disposable test database).
    await remote.run("DROP TABLE IF EXISTS chunks CASCADE");
    await remote.run("DROP TABLE IF EXISTS documents CASCADE");
    await remote.run("DROP TABLE IF EXISTS libraries CASCADE");
    await remote.run("DROP TABLE IF EXISTS _schema_version CASCADE");
    await runStorageMigrations(remote);
  });

  beforeEach(async () => {
    await remote.run("DELETE FROM chunks");
    await remote.run("DELETE FROM documents");
    await remote.run("DELETE FROM libraries");
  });

  afterAll(async () => {
    await remote.close();
  });

  /** Insert a library with the same column set the sync upsert pushes. */
  async function insertLibrary(input: {
    name: string;
    slug: string;
    description?: string;
    npm_package?: string;
    version?: string;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await remote.run(
      `INSERT INTO libraries
         (id, name, slug, description, npm_package, github_repo, docs_url, version,
          chunk_count, document_count, last_crawled_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, 0, 0, NULL, $7, $7)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug`,
      id,
      input.name,
      input.slug,
      input.description ?? null,
      input.npm_package ?? null,
      input.version ?? null,
      now,
    );
    return id;
  }

  /** Insert a document + chunk with the same column set the sync upsert pushes. */
  async function insertChunk(input: {
    libraryId: string;
    url: string;
    title: string;
    content: string;
  }): Promise<{ chunkId: string; documentId: string }> {
    const documentId = randomUUID();
    const chunkId = randomUUID();
    const now = new Date().toISOString();
    await remote.run(
      `INSERT INTO documents
         (id, library_id, url, title, content, parsed_at, created_at)
       VALUES ($1, $2, $3, $4, NULL, NULL, $5)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
      documentId,
      input.libraryId,
      input.url,
      input.title,
      now,
    );
    await remote.run(
      `INSERT INTO chunks
         (id, library_id, document_id, content, position, token_count, created_at)
       VALUES ($1, $2, $3, $4, 0, NULL, $5)
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content`,
      chunkId,
      input.libraryId,
      documentId,
      input.content,
      now,
    );
    return { chunkId, documentId };
  }

  test("chunk search returns ONLY matching chunks (not empty, not all)", async () => {
    const libId = await insertLibrary({ name: "FtsLib", slug: "fts-lib" });
    const match = await insertChunk({
      libraryId: libId,
      url: "https://example.com/guide/hooks",
      title: "Guide",
      content: "useState is a React hook for managing component state.",
    });
    await insertChunk({
      libraryId: libId,
      url: "https://example.com/guide/routing",
      title: "Guide",
      content: "Express routing middleware handles HTTP requests.",
    });

    const results = await remote.searchChunks("useState");
    expect(results.length).toBe(1);
    expect(results[0]!.chunk_id).toBe(match.chunkId);
    expect(results[0]!.content).toContain("useState");
    expect(results[0]!.url).toBe("https://example.com/guide/hooks");
    expect(results[0]!.title).toBe("Guide");
  });

  test("library-scoped chunk search filters by library", async () => {
    const libA = await insertLibrary({ name: "LibA", slug: "lib-a" });
    const libB = await insertLibrary({ name: "LibB", slug: "lib-b" });
    const chunkA = await insertChunk({
      libraryId: libA,
      url: "https://a.example.com/x",
      title: "A",
      content: "React hooks manage component state.",
    });
    await insertChunk({
      libraryId: libB,
      url: "https://b.example.com/x",
      title: "B",
      content: "React hooks manage component state.",
    });

    const scoped = await remote.searchChunks("hooks", libA);
    expect(scoped.map((r) => r.chunk_id)).toEqual([chunkA.chunkId]);
    const all = await remote.searchChunks("hooks");
    expect(all.length).toBe(2);
  });

  test("prefix search matches partial tokens (FTS5 prefix parity)", async () => {
    const libId = await insertLibrary({ name: "PrefixLib", slug: "prefix-lib" });
    await insertChunk({
      libraryId: libId,
      url: "https://example.com/p",
      title: "P",
      content: "The function supercalifragilistic is extremely long.",
    });

    const results = await remote.searchChunks("supercali");
    expect(results.length).toBe(1);
    expect(results[0]!.content).toContain("supercalifragilistic");
  });

  test("empty and stopword-only queries return no results", async () => {
    const libId = await insertLibrary({ name: "StopLib", slug: "stop-lib" });
    await insertChunk({
      libraryId: libId,
      url: "https://example.com/s",
      title: "S",
      content: "useState is a React hook for managing component state.",
    });

    expect(await remote.searchChunks("")).toEqual([]);
    expect(await remote.searchChunks("the")).toEqual([]);
  });

  test("library search finds libraries by name and description", async () => {
    const lib = await insertLibrary({
      name: "React Documentation",
      slug: "react-documentation",
      description: "Hooks and component API reference",
    });

    const byName = await remote.searchLibraries("documentation");
    expect(byName.map((l) => l.id)).toContain(lib);
    const byDescription = await remote.searchLibraries("component");
    expect(byDescription.map((l) => l.id)).toContain(lib);
  });

  test("library search falls back to ILIKE when FTS misses (local fallback parity)", async () => {
    const lib = await insertLibrary({ name: "The React Docs", slug: "the-react-docs" });

    // Prove the FTS predicate itself misses a stopword-only query on Postgres...
    const probe = await remote.all(
      "SELECT (to_tsvector('english', ?) @@ to_tsquery('english', ?)) AS matched",
      "The React Docs",
      "the:*",
    ) as Array<{ matched: boolean }>;
    expect(probe[0]?.matched).toBe(false);
    // ...and that searchLibraries still finds the library through the fallback.
    const results = await remote.searchLibraries("the");
    expect(results.map((l) => l.id)).toContain(lib);
  });

  test("getLibraryBySlug resolves a remote-only library by slug (hosted search resolution)", async () => {
    // A library that exists ONLY on the hosted backend (never synced to the
    // local SQLite store). Hosted library-scoped search surfaces resolve the
    // library through the SELECTED backend, so this must resolve remotely and
    // let hosted FTS run — previously it failed with LIBRARY_NOT_FOUND before
    // the hosted query could run (release-review P1).
    const lib = await insertLibrary({ name: "Remote Only", slug: "remote-only-lib" });

    const resolved = await remote.getLibraryBySlug("remote-only-lib");
    expect(resolved.id).toBe(lib);
    expect(resolved.slug).toBe("remote-only-lib");
    expect(resolved.name).toBe("Remote Only");
  });

  test("getLibraryBySlug throws LIBRARY_NOT_FOUND for an unknown slug", async () => {
    await expect(remote.getLibraryBySlug("no-such-library")).rejects.toThrow(/Library not found/);
  });

  test("listLibraries returns the full remote library set for reference resolution", async () => {
    // Remote-side coverage for release-review P1: the hosted query-docs path
    // resolves references against this listing (candidate + version-prefix
    // matching), so the remote adapter must expose the complete set.
    await insertLibrary({ name: "React 18", slug: "react-18", version: "18.2.0" });
    await insertLibrary({ name: "React 19", slug: "react-19", version: "19.0.0" });

    const all = await remote.listLibraries();
    expect(all.map((l) => l.slug)).toEqual(expect.arrayContaining(["react-18", "react-19"]));
    expect(all.find((l) => l.slug === "react-18")?.version).toBe("18.2.0");
  });

  test("semanticSearch ranks remote chunk embeddings by cosine similarity", async () => {
    // Remote-side coverage for release-review P1: hosted semantic search
    // used to run against local SQLite after resolving a remote-only library,
    // returning HTTP 200 with empty results while remote embeddings existed.
    const libId = await insertLibrary({ name: "Embedded", slug: "embedded-lib" });
    const { chunkId } = await insertChunk({
      libraryId: libId,
      url: "https://example.com/embed",
      title: "Embedded",
      content: "vector content",
    });
    // Migration 10 chunk_embeddings row, exactly as the sync upsert writes it
    // (BYTEA float32 little-endian embedding). `model` and `created_at` are
    // NOT NULL without defaults (pg-migrations.ts migration 10), so the
    // fixture must supply both or PostgreSQL rejects the insert.
    const embedding = new Float32Array([1, 0, 0]);
    const now = new Date().toISOString();
    await remote.run(
      `INSERT INTO chunk_embeddings (chunk_id, model, embedding, dimensions, created_at)
       VALUES ($1, 'test-model', $2, $3, $4)
       ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, dimensions = EXCLUDED.dimensions`,
      chunkId,
      Buffer.from(embedding.buffer),
      embedding.length,
      now,
    );

    const query = new Float32Array([1, 0, 0]);
    const results = await remote.semanticSearch(query, libId, 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.chunk_id).toBe(chunkId);
    expect(results[0]?.score).toBeGreaterThan(0.99);

    // Library-scoped filter: a different library's chunks are excluded.
    const otherLib = await insertLibrary({ name: "Other", slug: "other-lib" });
    const scoped = await remote.semanticSearch(query, otherLib, 5);
    expect(scoped).toHaveLength(0);
  });

  test("selected-backend resolution + dispatch with a REMOTE-ONLY library (server + MCP paths)", async () => {
    // Remote-side coverage for release-review P1: the hosted search surfaces
    // must resolve a library through the SELECTED backend (server
    // /api/search?library= via resolveLibraryBySlugOnBackend, MCP query-docs
    // via resolveLibraryOnBackend) and dispatch the search against that same
    // backend — a library that exists ONLY on the hosted Postgres backend
    // (never in local SQLite) must be searchable. Reverting the resolution to
    // local SQLite first must fail this test.
    const prevUrl = process.env["HASNA_CONTEXT_DATABASE_URL"];
    process.env["HASNA_CONTEXT_DATABASE_URL"] = PG_URL!;
    try {
      const libId = await insertLibrary({ name: "Remote Only", slug: "remote-only-lib", version: "2.4.1" });
      const { chunkId } = await insertChunk({
        libraryId: libId,
        url: "https://example.com/remote-only",
        title: "Remote Only",
        content: "remote-only content",
      });
      const embedding = new Float32Array([1, 0, 0]);
      const now = new Date().toISOString();
      await remote.run(
        `INSERT INTO chunk_embeddings (chunk_id, model, embedding, dimensions, created_at)
         VALUES ($1, 'test-model', $2, $3, $4)
         ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding, dimensions = EXCLUDED.dimensions`,
        chunkId,
        Buffer.from(embedding.buffer),
        embedding.length,
        now,
      );

      // Server path: GET /api/search?library=<slug> resolves through the
      // selected backend (server/index.ts).
      const bySlug = await resolveLibraryBySlugOnBackend("remote-only-lib");
      expect(bySlug.id).toBe(libId);

      // MCP path: query-docs reference resolution through the selected
      // backend (mcp/library-tools.ts), including version-prefix matching.
      const byRef = await resolveLibraryOnBackend("/context/remote-only-lib@2.4");
      expect(byRef.id).toBe(libId);

      // Dispatch: semantic search must run against the SELECTED backend and
      // return the remote-only library's chunk, not empty results.
      const results = await semanticSearchOnBackend(new Float32Array([1, 0, 0]), libId, 5);
      expect(results).toHaveLength(1);
      expect(results[0]?.chunk_id).toBe(chunkId);
    } finally {
      if (prevUrl === undefined) delete process.env["HASNA_CONTEXT_DATABASE_URL"];
      else process.env["HASNA_CONTEXT_DATABASE_URL"] = prevUrl;
    }
  });
});
