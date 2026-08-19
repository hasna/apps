/**
 * Tests for dataset management (src/lib/datasets.ts): save with upsert-by-
 * name semantics, schema round-trips, JSON/CSV export (including CSV quote
 * and comma escaping), and deletion.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDatabase, getDataDir } from "../db/schema.js";
import { saveDataset, getDataset, getDatasetByName, listDatasets, deleteDataset, exportDataset } from "./datasets.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "datasets-test-"));
  process.env["BROWSER_DB_PATH"] = join(tmpDir, "test.db");
  process.env["BROWSER_DATA_DIR"] = tmpDir;
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  delete process.env["BROWSER_DB_PATH"];
  delete process.env["BROWSER_DATA_DIR"];
});

describe("datasets", () => {
  it("saves a new dataset and reads it back with parsed rows and schema", () => {
    const ds = saveDataset({
      name: "products",
      sourceUrl: "https://example.com/products",
      sourceType: "page",
      rows: [{ title: "A", price: 10 }],
      schema: { title: "string", price: "number" },
    });
    expect(ds.name).toBe("products");
    expect(ds.row_count).toBe(1);
    expect(getDataset(ds.id)?.data).toEqual([{ title: "A", price: 10 }]);
    expect(getDataset(ds.id)?.schema).toEqual({ title: "string", price: "number" });
  });

  it("upserts by name: saving the same name refreshes rows and keeps identity", () => {
    const first = saveDataset({ name: "prices", rows: [{ v: 1 }] });
    const second = saveDataset({ name: "prices", rows: [{ v: 2 }, { v: 3 }] });
    expect(second.id).toBe(first.id);
    expect(second.row_count).toBe(2);
    expect(getDatasetByName("prices")?.data).toEqual([{ v: 2 }, { v: 3 }]);
  });

  it("returns null for an unknown id or name", () => {
    expect(getDataset("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(getDatasetByName("nope")).toBeNull();
  });

  it("lists datasets without the full data payload", () => {
    saveDataset({ name: "one", rows: [{ a: 1 }] });
    saveDataset({ name: "two", rows: [{ b: 2 }] });
    const all = listDatasets();
    expect(all).toHaveLength(2);
    expect(all[0].row_count).toBe(1);
  });

  it("deletes a dataset by name", () => {
    saveDataset({ name: "doomed", rows: [] });
    expect(deleteDataset("doomed")).toBe(true);
    expect(deleteDataset("doomed")).toBe(false);
  });

  it("throws when exporting a dataset that does not exist", () => {
    expect(() => exportDataset("ghost", "json")).toThrow(/not found/);
  });

  it("exports CSV with proper comma and quote escaping", () => {
    saveDataset({
      name: "csv-test",
      rows: [
        { name: "plain", note: "no escaping" },
        { name: "has,comma", note: 'has "quote" and comma, inside' },
      ],
    });
    const out = exportDataset("csv-test", "csv");
    const content = readFileSync(out.path, "utf8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("name,note");
    expect(lines[1]).toBe("plain,no escaping");
    expect(lines[2]).toBe('"has,comma","has ""quote"" and comma, inside"');
    expect(existsSync(out.path)).toBe(true);
    expect(out.size).toBe(content.length);
  });

  it("exports an empty dataset as an empty CSV", () => {
    saveDataset({ name: "empty-csv", rows: [] });
    const out = exportDataset("empty-csv", "csv");
    expect(out.size).toBe(0);
    expect(readFileSync(out.path, "utf8")).toBe("");
  });

  it("exports JSON with the raw rows pretty-printed", () => {
    saveDataset({ name: "json-test", rows: [{ a: 1 }, { a: 2 }] });
    const out = exportDataset("json-test", "json");
    expect(JSON.parse(readFileSync(out.path, "utf8"))).toEqual([{ a: 1 }, { a: 2 }]);
    expect(out.path.startsWith(join(getDataDir(), "exports"))).toBe(true);
  });
});
