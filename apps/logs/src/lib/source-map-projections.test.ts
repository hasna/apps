/**
 * Test gap coverage for src/lib/source-map-projections.ts.
 *
 * agent-authored: the SOL consult for this repo did not deliver a spec (two
 * distinct Codewith accounts: one capacity-refused before answering, one
 * admitted but timed out at 600s on both the initial call and its resume).
 * This analysis and these tests were produced by the sweep agent.
 *
 * The projection/sanitization module had no sibling test. These tests pin the
 * sanitization contract: host paths and unsafe relative paths become hashed
 * markers, identifiers and validation errors are bounded, ordinals are
 * de-duplicated, content hashes are normalized, and the SQLite projection is
 * idempotent and bounded at the 200-source limit.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { createTestDb } from "../db/index.ts";
import {
  appendRawEvent,
  indexRawEvent,
  type EventIndexInput,
  type TelemetryEnvelope,
} from "./event-store.ts";
import {
  sanitizeSourceMapArtifactRecord,
  sanitizeSourceMapContextRecord,
  sanitizeSourceMapIdentifierValue,
  sanitizeSourceMapPathValue,
  sanitizeSourceMapTelemetry,
  sourceMapFallbackIdentifier,
  sourceMapSourceRowId,
  upsertSourceMapProjection,
} from "./source-map-projections.ts";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hostMarker = (value: string) =>
  `[source-map-host_path:${sha256(value).slice(0, 16)}]`;
const unsafeRelativeMarker = (value: string) =>
  `[source-map-unsafe_relative:${sha256(value).slice(0, 16)}]`;
const idMarker = (value: string) =>
  `[source-map-id:${sha256(value).slice(0, 16)}]`;
const validationErrorMarker = (value: string) =>
  `[source-map-validation-error:${sha256(value).slice(0, 16)}]`;
const contentHashMarker = (value: string) =>
  `[source-map-content-hash:${sha256(value).slice(0, 16)}]`;

describe("sanitizeSourceMapTelemetry", () => {
  it("returns null for non-object, empty, and signal-less input", () => {
    expect(sanitizeSourceMapTelemetry(null)).toBeNull();
    expect(sanitizeSourceMapTelemetry("source_map")).toBeNull();
    expect(sanitizeSourceMapTelemetry([1, 2])).toBeNull();
    expect(sanitizeSourceMapTelemetry({})).toBeNull();
    expect(
      sanitizeSourceMapTelemetry({ sources: [], mappings: "" }),
    ).toBeNull();
  });

  it("detects a source-map signal from artifact_type and from a .map path", () => {
    const fromType = sanitizeSourceMapTelemetry({
      artifact_type: "source-map",
      version: 3,
      sources: [],
      mappings: "AAAA",
    });
    expect(fromType).not.toBeNull();
    expect(fromType?.version).toBe(3);
    expect(fromType?.validation_status).toBe("parsed");

    const fromPath = sanitizeSourceMapTelemetry({
      path: "/build/app.js.map",
      version: 3,
      sources: [],
      mappings: "",
    });
    expect(fromPath).not.toBeNull();
  });

  it("infers validation_status parsed only for version 3 + sources array + mappings string", () => {
    const ok = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      version: 3,
      sources: ["a.ts"],
      mappings: "AAAA",
    });
    expect(ok?.validation_status).toBe("parsed");

    const wrongVersion = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      version: 2,
      sources: ["a.ts"],
      mappings: "AAAA",
    });
    expect(wrongVersion?.validation_status).toBeUndefined();

    const missingMappings = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      version: 3,
      sources: ["a.ts"],
    });
    expect(missingMappings?.validation_status).toBeUndefined();
  });

  it("keeps allowlisted validation errors verbatim and hashes arbitrary ones", () => {
    const safe = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      validation_status: "malformed",
      validation_error: "source map JSON is invalid",
    });
    expect(safe?.validation_error).toBe("source map JSON is invalid");

    const secret = "error details with internals: /home/hasna/secret";
    const unsafe = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      validation_status: "malformed",
      validation_error: secret,
    });
    expect(unsafe?.validation_error).toBe(validationErrorMarker(secret));
    expect(unsafe?.validation_error).not.toContain("/home/hasna");
  });

  it("preserves already-hashed validation error markers", () => {
    const marker = "[source-map-validation-error:0123456789abcdef]";
    const result = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      validation_status: "malformed",
      validation_error: marker,
    });
    expect(result?.validation_error).toBe(marker);
  });

  it("computes content hashes from sourcesContent and marks has_content", () => {
    const content = "export const x = 1;\n";
    const result = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      version: 3,
      sources: ["src/a.ts"],
      sourcesContent: [content],
      mappings: "AAAA",
    });
    expect(result?.sources).toEqual([
      {
        ordinal: 0,
        source_path: "src/a.ts",
        has_content: true,
        content_hash: sha256(content),
      },
    ]);
    expect(result?.has_sources_content).toBe(true);
    expect(result?.source_count).toBe(1);
  });

  it("de-duplicates and renumbers colliding source ordinals", () => {
    const result = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      sources: [
        { ordinal: 0, source_path: "a.ts" },
        { ordinal: 0, source_path: "b.ts" },
        { ordinal: 5, source_path: "c.ts" },
        { ordinal: 5, source_path: "d.ts" },
      ],
    });
    const sources = result?.sources as
      | Array<{ ordinal: number }>
      | undefined;
    const ordinals = sources?.map((s) => s.ordinal) ?? [];
    expect(ordinals).toEqual([0, 1, 5, 6]);
    expect(ordinals).toHaveLength(new Set(ordinals).size);
  });

  it("falls back to index ordinals for negative or missing ordinals", () => {
    const result = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      sources: [
        { ordinal: -3, source_path: "a.ts" },
        { source_path: "b.ts" },
      ],
    });
    const sources = result?.sources as
      | Array<{ ordinal: number }>
      | undefined;
    expect(sources?.map((s) => s.ordinal)).toEqual([0, 1]);
  });

  it("truncates sources beyond the 200-source projection limit", () => {
    const sources = Array.from({ length: 250 }, (_, i) => `src/${i}.ts`);
    const result = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      sources,
      version: 3,
      mappings: "AAAA",
    });
    expect(result?.sources).toHaveLength(200);
    expect(result?.truncated).toBe(true);
    expect(result?.projected_source_limit).toBe(200);
  });

  it("coerces and bounds scalar values", () => {
    const result = sanitizeSourceMapTelemetry({
      source_map_id: "sm-1",
      version: 3.9,
      source_count: "7",
      names_count: NaN,
      mappings_length: 12.7,
      size_bytes: -4,
    });
    expect(result?.version).toBe(3);
    expect(result?.source_count).toBe(0); // string is not an integer; falls back to rawSources.length
    expect(result?.names_count).toBe(0); // NaN is not an integer; falls back to rawNames.length
    expect(result?.mappings_length).toBe(12);
    expect(result?.size_bytes).toBe(-4);
  });
});

describe("sanitizeSourceMapPathValue", () => {
  it("rejects non-strings, empties, and null bytes", () => {
    expect(sanitizeSourceMapPathValue(42)).toBeNull();
    expect(sanitizeSourceMapPathValue("")).toBeNull();
    expect(sanitizeSourceMapPathValue("a\0b")).toBeNull();
  });

  it("hashes host paths and unsafe relative paths", () => {
    expect(sanitizeSourceMapPathValue("/home/hasna/app.js")).toBe(
      hostMarker("/home/hasna/app.js"),
    );
    expect(sanitizeSourceMapPathValue("~/app.js")).toBe(
      hostMarker("~/app.js"),
    );
    expect(sanitizeSourceMapPathValue("C:/app.js")).toBe(
      hostMarker("C:/app.js"),
    );
    expect(sanitizeSourceMapPathValue("file:///x.js")).toBe(
      hostMarker("file:///x.js"),
    );
    expect(sanitizeSourceMapPathValue("../escape.js")).toBe(
      unsafeRelativeMarker("../escape.js"),
    );
    expect(sanitizeSourceMapPathValue("src/../../escape.js")).toBe(
      unsafeRelativeMarker("src/../../escape.js"),
    );
  });

  it("normalizes backslashes to forward slashes before judging", () => {
    expect(sanitizeSourceMapPathValue("src\\a\\b.ts")).toBe("src/a/b.ts");
    expect(sanitizeSourceMapPathValue("C:\\app.js")).toBe(
      hostMarker("C:/app.js"),
    );
  });

  it("drops empty and dot segments and truncates long paths", () => {
    expect(sanitizeSourceMapPathValue("src//a/./b.ts")).toBe("src/a/b.ts");
    const long = `src/${"x".repeat(600)}.ts`;
    const result = sanitizeSourceMapPathValue(long);
    expect(result).toBe(`${long.slice(0, 500)}... [truncated]`);
  });

  it("preserves valid pre-hashed markers and re-hashes malformed ones", () => {
    const valid = "[source-map-host_path:0123456789abcdef]";
    expect(sanitizeSourceMapPathValue(valid)).toBe(valid);
    const invalid = "[source-map-host_path:not-a-16-hex-marker]";
    expect(sanitizeSourceMapPathValue(invalid)).toBe(
      `[source-map-unsafe_marker:${sha256(invalid).slice(0, 16)}]`,
    );
  });
});

describe("sanitizeSourceMapIdentifierValue", () => {
  it("keeps plain identifiers and hashes path-like or whitespace ones", () => {
    expect(sanitizeSourceMapIdentifierValue("app.js")).toBe("app.js");
    expect(sanitizeSourceMapIdentifierValue("a/b.js")).toBe(idMarker("a/b.js"));
    expect(sanitizeSourceMapIdentifierValue("../up")).toBe(idMarker("../up"));
    expect(sanitizeSourceMapIdentifierValue("with space")).toBe(
      idMarker("with space"),
    );
    expect(sanitizeSourceMapIdentifierValue("/abs")).toBe(idMarker("/abs"));
    expect(sanitizeSourceMapIdentifierValue("a\\b.js")).toBe(
      idMarker("a/b.js"),
    );
  });

  it("preserves valid id markers and hashes other marker shapes", () => {
    const valid = "[source-map-id:0123456789abcdef]";
    expect(sanitizeSourceMapIdentifierValue(valid)).toBe(valid);
    const other = "[source-map-scalar:0123456789abcdef]";
    expect(sanitizeSourceMapIdentifierValue(other)).toBe(idMarker(other));
  });

  it("truncates long identifiers", () => {
    const long = "id".repeat(300);
    const result = sanitizeSourceMapIdentifierValue(long);
    expect(result).toBe(`${long.slice(0, 500)}... [truncated]`);
  });
});

describe("sourceMapFallbackIdentifier and sourceMapSourceRowId", () => {
  it("produces deterministic fallback identifiers", () => {
    expect(sourceMapFallbackIdentifier("evt-1")).toBe(
      sourceMapFallbackIdentifier("evt-1"),
    );
    expect(sourceMapFallbackIdentifier("evt-1")).not.toBe(
      sourceMapFallbackIdentifier("evt-2"),
    );
  });

  it("derives stable source row ids from md5(source_map_id:ordinal)", () => {
    const expected = `srcmap_source_${createHash("md5")
      .update("sm-1")
      .update(":")
      .update("3")
      .digest("hex")}`;
    expect(sourceMapSourceRowId("sm-1", 3)).toBe(expected);
    expect(sourceMapSourceRowId("sm-1", 3)).toBe(
      sourceMapSourceRowId("sm-1", 3),
    );
    expect(sourceMapSourceRowId("sm-1", 3)).not.toBe(
      sourceMapSourceRowId("sm-1", 4),
    );
  });
});

describe("sanitizeSourceMapArtifactRecord", () => {
  it("returns {} for empty input", () => {
    expect(sanitizeSourceMapArtifactRecord({})).toEqual({});
  });

  it("projects source-map artifacts and strips root source-map keys", () => {
    const output = sanitizeSourceMapArtifactRecord({
      artifact_type: "source_map",
      tool: "vite",
      path: "/build/app.js.map",
      category: "build_artifact",
      source_map: {
        source_map_id: "sm-1",
        version: 3,
        sources: ["src/a.ts"],
        mappings: "AAAA",
      },
    });
    expect(output.artifact_type).toBe("source_map");
    expect(output.tool).toBe("vite");
    expect(output.path).toBe(hostMarker("/build/app.js.map"));
    expect(output.category).toBe("build_artifact");
    expect(output.source_map).toMatchObject({ source_map_id: "sm-1" });
    expect(output.version).toBeUndefined(); // root-level keys are stripped
    expect(output.sources).toBeUndefined();
  });

  it("leaves non-source-map artifacts intact apart from nested sanitization", () => {
    const output = sanitizeSourceMapArtifactRecord({
      artifact_type: "test_report",
      path: "report.xml",
      source_map: {
        source_map_id: "/home/hasna/secret-id",
      },
    });
    expect(output.artifact_type).toBe("test_report");
    expect(output.path).toBe("report.xml");
    expect(
      (output.source_map as Record<string, unknown> | undefined)?.source_map_id,
    ).toBe(idMarker("/home/hasna/secret-id"));
  });

  it("detects source-map artifacts by .map path suffix", () => {
    const output = sanitizeSourceMapArtifactRecord({
      path: "dist/app.js.map",
      size_bytes: 10,
    });
    expect(output.artifact_type).toBe("source_map");
  });
});

describe("sanitizeSourceMapContextRecord", () => {
  it("sanitizes ids, paths, hashes, artifact types, and scalar allowlists", () => {
    const output = sanitizeSourceMapContextRecord({
      artifact_id: "/home/hasna/artifact",
      source_map_path: "../up",
      content_hash: "not-a-hash",
      artifact_type: "source-map",
      tool: "webpack",
      script: "evil script",
    });
    expect(output.artifact_id).toBe(idMarker("/home/hasna/artifact"));
    expect(output.source_map_path).toBe(
      unsafeRelativeMarker("../up"),
    );
    expect(output.content_hash).toBe(contentHashMarker("not-a-hash"));
    expect(output.artifact_type).toBe("source_map");
    expect(output.tool).toBe("webpack");
    expect(output.script).toMatch(/^\[source-map-scalar:[a-f0-9]{16}\]$/);
  });
});

describe("upsertSourceMapProjection", () => {
  function envelope(sourceMap: Record<string, unknown>): TelemetryEnvelope {
    const now = new Date().toISOString();
    return {
      schema_version: 1,
      event_id: "evt-sourcemap-1",
      source_event_id: null,
      event_time: now,
      ingest_time: now,
      type: "artifact",
      source: "scanner",
      severity: "info",
      privacy: "internal",
      message: "source map",
      body: { artifact: { artifact_type: "source_map", source_map: sourceMap } },
      attributes: {},
    };
  }

  const index: EventIndexInput = {
    event_id: "evt-sourcemap-1",
    event_type: "artifact",
    event_time: new Date().toISOString(),
    ingest_time: new Date().toISOString(),
    source: "scanner",
    project_id: "proj-1",
  };

  /** Insert the envelope's event record so the source_maps FK resolves. */
  function indexEnvelope(db: ReturnType<typeof createTestDb>, evt: TelemetryEnvelope): void {
    db.prepare(
      "INSERT OR IGNORE INTO projects (id, name) VALUES (?, ?)",
    ).run("proj-1", "proj-1");
    const write = appendRawEvent(db, evt);
    indexRawEvent(
      db,
      {
        event_id: evt.event_id,
        schema_version: evt.schema_version,
        source_event_id: evt.source_event_id ?? null,
        event_type: evt.type,
        event_time: evt.event_time,
        ingest_time: evt.ingest_time,
        severity: evt.severity ?? null,
        source: evt.source,
        environment: evt.environment ?? null,
        privacy_tier: evt.privacy ?? null,
        message: evt.message ?? null,
        metadata: evt.attributes ?? {},
      },
      write,
    );
  }

  it("inserts the projection row and its sources, idempotently", () => {
    const db = createTestDb();
    const sourceMap = {
      source_map_id: "sm-1",
      version: 3,
      sources: ["src/a.ts", "src/b.ts"],
      sourcesContent: ["content-a", "content-b"],
      mappings: "AAAA",
    };
    const evt = envelope(sourceMap);
    indexEnvelope(db, evt);
    upsertSourceMapProjection(db, evt, index);

    const row = db
      .prepare("SELECT * FROM source_maps WHERE id = ?")
      .get("sm-1") as Record<string, unknown>;
    expect(row).not.toBeNull();
    expect(row.event_id).toBe("evt-sourcemap-1");
    expect(row.project_id).toBe("proj-1");
    expect(row.validation_status).toBe("parsed");
    expect(row.source_count).toBe(2);
    expect(row.has_sources_content).toBe(1);
    expect(row.truncated).toBe(0);

    const sources = db
      .prepare("SELECT * FROM source_map_sources WHERE source_map_id = ? ORDER BY ordinal")
      .all("sm-1") as Array<Record<string, unknown>>;
    expect(sources).toHaveLength(2);
    expect(sources[0]?.ordinal).toBe(0);
    expect(sources[0]?.source_path).toBe("src/a.ts");
    expect(sources[0]?.has_content).toBe(1);
    expect(sources[0]?.content_hash).toBe(sha256("content-a"));

    // Idempotent re-projection: same id, same rows, no duplicates.
    upsertSourceMapProjection(db, evt, index);
    const after = db
      .prepare("SELECT COUNT(*) AS n FROM source_map_sources WHERE source_map_id = ?")
      .get("sm-1") as { n: number };
    expect(after.n).toBe(2);
  });

  it("falls back to a hashed event-id identifier when no source_map_id exists", () => {
    const db = createTestDb();
    const evt = envelope({ version: 3, sources: ["a.ts"], mappings: "AAAA" });
    indexEnvelope(db, evt);
    upsertSourceMapProjection(db, evt, index);
    const expectedId = `[source-map-id:${sha256(`fallback:evt-sourcemap-1`).slice(0, 16)}]`;
    const row = db
      .prepare("SELECT id FROM source_maps WHERE event_id = ?")
      .get("evt-sourcemap-1") as { id: string };
    expect(row.id).toBe(expectedId);
  });

  it("caps the projected sources at 200 rows and flags truncation", () => {
    const db = createTestDb();
    const sources = Array.from({ length: 250 }, (_, i) => `src/${i}.ts`);
    const evt = envelope({
      source_map_id: "sm-big",
      version: 3,
      sources,
      mappings: "AAAA",
    });
    indexEnvelope(db, evt);
    upsertSourceMapProjection(db, evt, index);
    const row = db
      .prepare("SELECT source_count, truncated FROM source_maps WHERE id = ?")
      .get("sm-big") as { source_count: number; truncated: number };
    expect(row.source_count).toBe(250);
    expect(row.truncated).toBe(1);
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM source_map_sources WHERE source_map_id = ?")
      .get("sm-big") as { n: number };
    expect(n.n).toBe(200);
  });
});
