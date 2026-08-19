import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDatasetCanvasSpec, buildDatasetRenderSpec } from "./render.js";
import type { JsonObject } from "./schemas.js";
import { DATASETS_DB_PATH_ENV, DATASETS_HOME_ENV, ingestDataset } from "./storage.js";

const ENV_KEYS = [DATASETS_HOME_ENV, DATASETS_DB_PATH_ENV] as const;
const savedEnv = new Map<string, string | undefined>();
let testDir: string | undefined;

for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "datasets-render-"));
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

describe("dataset render adapters", () => {
  test("builds a JSON Render table spec", () => {
    const dataset = ingestDataset({
      name: "Bank shortlist",
      projectId: "swiss-bank-account",
      rows: [{ bank: "Mirabaud", status: "research" }],
    }).dataset;

    const spec = buildDatasetRenderSpec({ dataset: dataset.slug, projectId: "swiss-bank-account" });

    expect(spec.root).toBe("root");
    expect(spec.elements.root.type).toBe("Table");
    const props = spec.elements.root.props as JsonObject;

    expect(props.title).toBe("Bank shortlist");
    expect(spec.metadata.renderer).toBe("json_render");
  });

  test("builds a non-overlap canvas spec with optional connections metadata", () => {
    ingestDataset({
      name: "Documents",
      projectId: "swiss-bank-account",
      rows: [{ document: "Potential contract", status: "review" }],
    });

    const spec = buildDatasetCanvasSpec({ projectId: "swiss-bank-account" });
    const root = spec.elements.root.props as JsonObject;

    expect(spec.metadata.renderer).toBe("react_flow");
    expect(root.ui_contract).toMatchObject({ connections_optional: true, non_overlapping_nodes: true });
    expect((root.nodes as JsonObject[]).length).toBe(3);
    expect((root.edges as JsonObject[]).length).toBe(2);
    expect((root.data as JsonObject).privacy).toMatchObject({ previews_bounded: true, raw_records_embedded: false });
  });

  test("bounds a canvas preview and marks it truncated when more rows exist", () => {
    ingestDataset({
      name: "Large sample",
      projectId: "swiss-bank-account",
      rows: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });

    const spec = buildDatasetCanvasSpec({ projectId: "swiss-bank-account", limit: 1 });
    const root = spec.elements.root.props as JsonObject;
    const nodes = root.nodes as JsonObject[];
    const sample = nodes.find((node) => node.type === "dataset.sample");

    expect(sample?.data).toMatchObject({ status: "truncated" });
    expect((sample?.data as JsonObject).items).toHaveLength(1);
  });

  test("marks a canvas sample ready when the limit covers the whole dataset", () => {
    ingestDataset({
      name: "Small sample",
      projectId: "swiss-bank-account",
      rows: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });

    const spec = buildDatasetCanvasSpec({ projectId: "swiss-bank-account", limit: 5 });
    const root = spec.elements.root.props as JsonObject;
    const nodes = root.nodes as JsonObject[];
    const sample = nodes.find((node) => node.type === "dataset.sample");

    expect(sample?.data).toMatchObject({ status: "ready" });
  });

  test("redacts private values in render specs by default and honors redact:false", () => {
    ingestDataset({
      name: "Secret Ledger",
      projectId: "swiss-bank-account",
      classification: "private",
      rows: [{ id: "p1", balance: 1_000_000 }],
    });

    const redacted = buildDatasetRenderSpec({ dataset: "secret-ledger", projectId: "swiss-bank-account" });
    const raw = buildDatasetRenderSpec({ dataset: "secret-ledger", projectId: "swiss-bank-account", redact: false });

    expect((redacted.elements.root.props as JsonObject).rows).toEqual([{ id: "[redacted]", balance: "[redacted]" }]);
    expect((raw.elements.root.props as JsonObject).rows).toEqual([{ id: "p1", balance: 1_000_000 }]);
  });

  test("throws for missing datasets in both render and canvas specs", () => {
    expect(() => buildDatasetRenderSpec({ dataset: "nope", projectId: "swiss-bank-account" })).toThrow("Dataset not found: nope");
    expect(() => buildDatasetCanvasSpec({ projectId: "swiss-bank-account", dataset: "nope" })).toThrow("Dataset not found: nope");
  });

  test("emits zero nodes and edges for a project without datasets", () => {
    const spec = buildDatasetCanvasSpec({ projectId: "empty-project" });
    const root = spec.elements.root.props as JsonObject;

    expect(root.nodes).toEqual([]);
    expect(root.edges).toEqual([]);
  });

  test("lays out multiple datasets without overlapping positions and connects edges to real node ids", () => {
    ingestDataset({ name: "First", projectId: "swiss-bank-account", classification: "public", rows: [{ id: "a" }] });
    ingestDataset({ name: "Second", projectId: "swiss-bank-account", classification: "public", rows: [{ id: "b" }] });

    const spec = buildDatasetCanvasSpec({ projectId: "swiss-bank-account", limit: 10 });
    const root = spec.elements.root.props as JsonObject;
    const nodes = root.nodes as Array<{ id: string; position: { x: number; y: number }; data: JsonObject }>;
    const edges = root.edges as Array<{ id: string; source: string; target: string }>;

    expect(nodes).toHaveLength(6);
    const nodeIds = new Set(nodes.map((node) => node.id));
    expect(nodeIds.size).toBe(6);
    const positions = nodes.map((node) => `${node.position.x},${node.position.y}`);
    expect(new Set(positions).size).toBe(6);
    for (const edge of edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    expect(edges).toHaveLength(4);
  });
});
