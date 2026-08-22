import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATASETS_DB_PATH_ENV,
  DATASETS_HOME_ENV,
  DATASETS_MAX_SCAN_ROWS,
  createDatasetProjection,
  createSource,
  getDataset,
  ingestDataset,
  listDatasets,
  listProjections,
  listSources,
  previewDataset,
  slugify,
  storageStatus,
} from "./storage.js";

const ENV_KEYS = [DATASETS_HOME_ENV, DATASETS_DB_PATH_ENV] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "datasets-storage-"));
  process.env[DATASETS_HOME_ENV] = testDir;
  process.env[DATASETS_DB_PATH_ENV] = join(testDir, "datasets.db");
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("datasets storage", () => {
  test("registers sources, ingests rows, and returns bounded previews", () => {
    const source = createSource({
      name: "Swiss paperwork CSV",
      kind: "csv",
      path: join(testDir!, "paperwork.csv"),
      projectId: "swiss-bank-account",
    });

    const { dataset, version } = ingestDataset({
      name: "Bank shortlist",
      projectId: "swiss-bank-account",
      sourceId: source.id,
      classification: "public",
      rows: [
        { Bank: "Mirabaud", Jurisdiction: "CH", Minimum: 1_000_000, Status: "research" },
        { Bank: "UBS", Jurisdiction: "CH", Minimum: 1_000_000, Status: "research" },
      ],
    });

    expect(source.slug).toBe("swiss-paperwork-csv");
    expect(dataset.slug).toBe("bank-shortlist");
    expect(dataset.projectId).toBe("swiss-bank-account");
    expect(version.rowCount).toBe(2);
    expect(listSources("swiss-bank-account")).toHaveLength(1);
    expect(listDatasets("swiss-bank-account")).toHaveLength(1);

    const preview = previewDataset("bank-shortlist", { limit: 1 }, "swiss-bank-account");
    expect(preview.rows).toEqual([{ bank: "Mirabaud", jurisdiction: "CH", minimum: 1_000_000, status: "research" }]);
    expect(preview.truncated).toBe(true);
    expect(Object.keys(dataset.schema.properties ?? {})).toEqual(["bank", "jurisdiction", "minimum", "status"]);
  });

  test("redacts private dataset previews by default", () => {
    ingestDataset({
      name: "Private Documents",
      projectId: "swiss-bank-account",
      classification: "private",
      rows: [{ id: "doc-1", tax_id: "secret-tax-id", status: "needs review" }],
    });

    const redacted = previewDataset("private-documents", { limit: 1 }, "swiss-bank-account");
    const unredacted = previewDataset("private-documents", { limit: 1, redact: false }, "swiss-bank-account");

    expect(redacted.rows[0]).toMatchObject({ id: "[redacted]", tax_id: "[redacted]", status: "[redacted]" });
    expect(unredacted.rows[0]).toMatchObject({ id: "doc-1", tax_id: "secret-tax-id", status: "needs review" });
  });

  test("rolls back failed ingests instead of leaving partial dataset records", () => {
    expect(() => ingestDataset({
      name: "Duplicate Keys",
      projectId: "swiss-bank-account",
      rows: [
        { id: "same", bank: "Mirabaud" },
        { id: "same", bank: "UBS" },
      ],
    })).toThrow();

    expect(storageStatus()).toMatchObject({ datasets: 0, records: 0 });
  });

  test("keeps duplicate dataset slugs unique per project", () => {
    const first = ingestDataset({ name: "Contracts", projectId: "alpha", rows: [{ id: "a" }] }).dataset;
    const second = ingestDataset({ name: "Contracts", projectId: "alpha", rows: [{ id: "b" }] }).dataset;
    const third = ingestDataset({ name: "Contracts", projectId: "beta", rows: [{ id: "c" }] }).dataset;

    expect(first.slug).toBe("contracts");
    expect(second.slug).toBe("contracts-2");
    expect(third.slug).toBe("contracts");
  });

  test("creates saved projections and exposes storage status", () => {
    const dataset = ingestDataset({ name: "Documents", projectId: "swiss-bank-account", rows: [{ id: "doc-1", type: "contract" }] }).dataset;
    const projection = createDatasetProjection({
      dataset: dataset.id,
      name: "Contract cards",
      kind: "cards",
      query: { filters: { type: "contract" } },
    });

    expect(projection.slug).toBe("contract-cards");
    expect(listProjections(dataset.id)).toHaveLength(1);
    expect(getDataset(dataset.slug, "swiss-bank-account")?.id).toBe(dataset.id);
    expect(storageStatus()).toMatchObject({ sources: 0, datasets: 1, records: 1, exists: true });
  });

  test("filters, sorts, paginates, and selects columns in one bounded preview", () => {
    ingestDataset({
      name: "Scores",
      projectId: "alpha",
      classification: "public",
      rows: [
        { id: "one", status: "ready", score: 2 },
        { id: "two", status: "review", score: 10 },
        { id: "three", status: "review", score: 1 },
      ],
    });

    const preview = previewDataset("scores", {
      filters: { status: "review" },
      sort: [{ column: "score", direction: "desc" }],
      offset: 1,
      limit: 1,
      columns: ["id", "score"],
      redact: false,
    }, "alpha");

    expect(preview.rows).toEqual([{ id: "three", score: 1 }]);
    expect(preview.columns).toEqual(["id", "score"]);
    expect(preview.total).toBe(2);
    expect(preview.truncated).toBe(false);
  });

  test("marks an offset preview truncated against the full dataset", () => {
    ingestDataset({
      name: "Rows",
      projectId: "alpha",
      classification: "public",
      rows: [{ id: "one" }, { id: "two" }, { id: "three" }],
    });

    const preview = previewDataset("rows", { offset: 1, limit: 1, redact: false }, "alpha");

    expect(preview.rows).toEqual([{ id: "two" }]);
    expect(preview.total).toBe(3);
    expect(preview.truncated).toBe(true);
  });

  test("slugifies empty and punctuation-only names to a stable fallback", () => {
    expect(slugify(" A/B  C ")).toBe("a-b-c");
    expect(slugify("!!!")).toBe("dataset");
  });

  test("throws a named error when previewing a missing dataset", () => {
    expect(() => previewDataset("does-not-exist", { limit: 1 }, "alpha")).toThrow("Dataset not found: does-not-exist");
  });

  test("never redacts public or internal classifications even when redact is requested", () => {
    ingestDataset({
      name: "Public Ledger",
      projectId: "alpha",
      classification: "public",
      rows: [{ id: "p1", tax_id: "visible" }],
    });
    ingestDataset({
      name: "Internal Ledger",
      projectId: "alpha",
      classification: "internal",
      rows: [{ id: "i1", tax_id: "visible" }],
    });

    const publicRows = previewDataset("public-ledger", { redact: true }, "alpha").rows;
    const internalRows = previewDataset("internal-ledger", { redact: true }, "alpha").rows;

    expect(publicRows[0]).toMatchObject({ id: "p1", tax_id: "visible" });
    expect(internalRows[0]).toMatchObject({ id: "i1", tax_id: "visible" });
  });

  test("redaction preserves explicit nulls as null instead of masking them", () => {
    ingestDataset({
      name: "Sensitive Records",
      projectId: "alpha",
      classification: "sensitive",
      rows: [
        { id: "s1", value: null },
        { id: "s2", value: "secret" },
      ],
    });

    const redacted = previewDataset("sensitive-records", { redact: true }, "alpha").rows;

    expect(redacted).toEqual([
      { id: "[redacted]", value: null },
      { id: "[redacted]", value: "[redacted]" },
    ]);
  });

  test("filters match exact values only, and missing keys never match a null filter", () => {
    ingestDataset({
      name: "Tagged",
      projectId: "alpha",
      classification: "public",
      rows: [
        { id: "a", tag: null },
        { id: "b" },
        { id: "c", tag: "x" },
      ],
    });

    const nullMatches = previewDataset("tagged", { filters: { tag: null }, redact: false }, "alpha").rows;
    const stringMatches = previewDataset("tagged", { filters: { tag: "x" }, redact: false }, "alpha").rows;
    const andMatches = previewDataset("tagged", { filters: { tag: null, id: "a" }, redact: false }, "alpha").rows;

    expect(nullMatches.map((row) => row.id)).toEqual(["a"]);
    expect(stringMatches.map((row) => row.id)).toEqual(["c"]);
    expect(andMatches.map((row) => row.id)).toEqual(["a"]);
  });

  test("sorts numeric-aware with missing values first ascending and last descending", () => {
    ingestDataset({
      name: "Sorted Rows",
      projectId: "alpha",
      classification: "public",
      rows: [
        { id: "a", n: 2 },
        { id: "b", n: "10" },
        { id: "c" },
        { id: "d", n: 1 },
      ],
    });

    const asc = previewDataset("sorted-rows", { sort: [{ column: "n", direction: "asc" }], redact: false }, "alpha").rows;
    const desc = previewDataset("sorted-rows", { sort: [{ column: "n", direction: "desc" }], redact: false }, "alpha").rows;

    expect(asc.map((row) => row.id)).toEqual(["c", "d", "a", "b"]);
    expect(desc.map((row) => row.id)).toEqual(["b", "a", "d", "c"]);
  });

  test("breaks sort ties with subsequent sort keys", () => {
    ingestDataset({
      name: "Ties",
      projectId: "alpha",
      classification: "public",
      rows: [
        { g: "x", n: 1, id: "a" },
        { g: "x", n: 1, id: "b" },
        { g: "y", n: 0, id: "c" },
        { g: "x", n: 2, id: "d" },
      ],
    });

    const ordered = previewDataset("ties", {
      sort: [
        { column: "g", direction: "asc" },
        { column: "n", direction: "desc" },
        { column: "id", direction: "asc" },
      ],
      redact: false,
    }, "alpha").rows;

    expect(ordered.map((row) => row.id)).toEqual(["d", "a", "b", "c"]);
  });

  test("resolves duplicate slugs by project scope and returns the first insert unscoped", () => {
    const alpha = ingestDataset({ name: "Shared", projectId: "alpha", rows: [{ id: "a" }] }).dataset;
    const beta = ingestDataset({ name: "Shared", projectId: "beta", rows: [{ id: "b" }] }).dataset;

    expect(getDataset("shared", "alpha")?.id).toBe(alpha.id);
    expect(getDataset("shared", "beta")?.id).toBe(beta.id);
    expect(getDataset("shared")?.id).toBe(alpha.id);
    expect(previewDataset("shared", { redact: false }, "beta").rows).toEqual([{ id: "b" }]);
  });

  test("ingests an empty row set with an empty schema and a deterministic checksum", () => {
    const { dataset, version } = ingestDataset({ name: "Empty", projectId: "alpha", rows: [] });

    expect(dataset.rowCount).toBe(0);
    expect(dataset.schema).toEqual({ type: "object", properties: {}, required: [] });
    expect(version.sample).toEqual([]);
    expect(version.manifest).toEqual({ sampleSize: 0 });
    expect(dataset.checksum).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
  });

  test("caps the stored version sample and manifest at twenty rows", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({ id: `r${index}` }));
    const { version } = ingestDataset({ name: "Big", projectId: "alpha", rows });

    expect(version.rowCount).toBe(25);
    expect(version.sample).toHaveLength(20);
    expect(version.manifest).toEqual({ sampleSize: 20 });
  });

  test("stores an explicit schema verbatim instead of inferring one", () => {
    const { dataset } = ingestDataset({
      name: "Fixed Schema",
      projectId: "alpha",
      rows: [{ x: 1 }],
      schema: { type: "object", properties: { y: { type: "string" } }, required: ["y"] },
    });

    expect(dataset.schema).toEqual({ type: "object", properties: { y: { type: "string" } }, required: ["y"] });
  });

  test("collapses source field names that slugify identically into one column, last value winning", () => {
    const { dataset } = ingestDataset({
      name: "Colliding Fields",
      projectId: "alpha",
      classification: "public",
      rows: [{ "a-b": 1, "a b": 2 }],
    });

    expect(Object.keys(dataset.schema.properties ?? {})).toEqual(["a_b"]);
    expect(previewDataset("colliding-fields", { redact: false }, "alpha").rows).toEqual([{ a_b: 2 }]);
  });

  test("bounds filtered scans to the scan row cap, hiding rows beyond the window", () => {
    const rows = Array.from({ length: DATASETS_MAX_SCAN_ROWS + 1 }, (_, index) => ({
      id: `r${index}`,
      tag: index < DATASETS_MAX_SCAN_ROWS ? "a" : "z",
    }));
    ingestDataset({ name: "Huge", projectId: "alpha", classification: "public", rows });

    const zMatches = previewDataset("huge", { filters: { tag: "z" }, redact: false }, "alpha");
    const aMatches = previewDataset("huge", { filters: { tag: "a" }, redact: false }, "alpha");

    expect(zMatches.rows).toEqual([]);
    expect(zMatches.total).toBe(0);
    expect(aMatches.total).toBe(DATASETS_MAX_SCAN_ROWS);
    expect(aMatches.truncated).toBe(true);
  });

  test("redacts falsy values but preserves explicit nulls", () => {
    ingestDataset({
      name: "Falsy Ledger",
      projectId: "alpha",
      classification: "private",
      rows: [{ id: "x", zero: 0, empty: "", no: false, n: null }],
    });

    expect(previewDataset("falsy-ledger", { redact: true }, "alpha").rows).toEqual([
      { id: "[redacted]", zero: "[redacted]", empty: "[redacted]", no: "[redacted]", n: null },
    ]);
  });

  test("lists global sources inside every project scope", () => {
    createSource({ name: "Global Src", kind: "csv", path: "/tmp/global.csv" });
    createSource({ name: "Local Src", kind: "csv", path: "/tmp/local.csv", projectId: "alpha" });

    const inAlpha = listSources("alpha").map((source) => source.name);
    const inOther = listSources("other").map((source) => source.name);

    expect(inAlpha).toEqual(["Local Src", "Global Src"]);
    expect(inOther).toEqual(["Global Src"]);
  });

  test("derives record keys from id, then key, then slug, then a padded fallback", () => {
    const { dataset } = ingestDataset({
      name: "Keyed Rows",
      projectId: "alpha",
      classification: "public",
      rows: [
        { id: "i1" },
        { key: "k1" },
        { slug: "s1" },
        { id: "", key: "fallback" },
        { x: 1 },
      ],
    });

    const db = new Database(process.env[DATASETS_DB_PATH_ENV]!);
    const keys = db
      .query<{ key: string }, [string]>("SELECT key FROM dataset_records WHERE dataset_id = ? ORDER BY ordinal ASC")
      .all(dataset.id)
      .map((row) => row.key);
    db.close();

    expect(dataset.rowCount).toBe(5);
    expect(keys).toEqual(["i1", "k1", "s1", "row_000004", "row_000005"]);
  });

  test("nulls a dataset sourceId when its source is deleted through the foreign key", () => {
    const source = createSource({ name: "Doomed", kind: "csv", path: "/tmp/doomed.csv", projectId: "alpha" });
    const dataset = ingestDataset({ name: "Tied", projectId: "alpha", sourceId: source.id, rows: [{ id: "1" }] }).dataset;

    const db = new Database(process.env[DATASETS_DB_PATH_ENV]!);
    db.run("PRAGMA foreign_keys=ON");
    db.run("DELETE FROM dataset_sources WHERE id = ?", [source.id]);
    db.close();

    expect(getDataset(dataset.id)?.sourceId).toBeNull();
  });

  test("infers sorted type unions and excludes null-only keys from required", () => {
    const { dataset } = ingestDataset({
      name: "Mixed Types",
      projectId: "alpha",
      classification: "public",
      rows: [
        { a: 1 },
        { a: 2.5 },
        { b: "x" },
        { b: null },
        { c: null },
      ],
    });

    expect(dataset.schema).toEqual({
      type: "object",
      properties: {
        a: { type: ["integer", "number"] },
        b: { type: ["null", "string"] },
        c: { type: "null" },
      },
      required: ["a", "b"],
    });
  });

  test("round-trips ui schema, metadata, source revision, and a shared checksum through the version", () => {
    const { dataset, version } = ingestDataset({
      name: "Round Trip",
      projectId: "alpha",
      classification: "sensitive",
      sourceRevision: "rev-1",
      rows: [{ id: "r1" }],
      uiSchema: { layout: "list" },
      metadata: { origin: "probe" },
    });

    expect(dataset.uiSchema).toEqual({ layout: "list" });
    expect(dataset.metadata).toEqual({ origin: "probe" });
    expect(version.sourceRevision).toBe("rev-1");
    expect(version.version).toBe(1);
    expect(version.checksum).toBe(dataset.checksum);
    expect(dataset.byteSize).toBe(13);
  });

  test("creates projections of every kind, preserves a null render spec, and allows duplicate names across datasets", () => {
    const first = ingestDataset({ name: "Projected", projectId: "alpha", rows: [{ id: "1" }] }).dataset;
    const second = ingestDataset({ name: "Projected Two", projectId: "alpha", rows: [{ id: "2" }] }).dataset;

    const slugs = (["table", "cards", "chart", "timeline", "canvas"] as const).map((kind) =>
      createDatasetProjection({ dataset: first.id, name: `P ${kind}`, kind }).slug,
    );
    const nullSpec = createDatasetProjection({ dataset: first.id, name: "Null Spec", kind: "table", renderSpec: null });
    const dupFirst = createDatasetProjection({ dataset: first.id, name: "Dup", kind: "table" });
    const dupSecond = createDatasetProjection({ dataset: second.id, name: "Dup", kind: "table" });

    expect(slugs).toEqual(["p-table", "p-cards", "p-chart", "p-timeline", "p-canvas"]);
    expect(nullSpec.renderSpec).toBeNull();
    expect(dupFirst.slug).toBe("dup");
    expect(dupSecond.slug).toBe("dup");
    expect(listProjections(first.id)).toHaveLength(7);
  });
});
