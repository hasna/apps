import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATASETS_DB_PATH_ENV,
  DATASETS_HOME_ENV,
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

describe("open-datasets storage", () => {
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
});
