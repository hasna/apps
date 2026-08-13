import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseExists, createBaseFile, loadBaseFile, resolveBasePath, saveBaseFile } from "./store.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "hasna-tables-"));
  process.env.HASNA_TABLES_DIR = dir;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
  test("resolves named bases into the data dir", () => {
    expect(resolveBasePath("crm")).toBe(join(dir, "crm.json"));
  });

  test("resolves explicit .json paths directly", () => {
    expect(resolveBasePath("/tmp/x.json")).toBe("/tmp/x.json");
  });

  test("create, mutate, save, reload round-trips", () => {
    const { model } = createBaseFile("crm", "CRM");
    expect(baseExists("crm")).toBe(true);
    model.createTable({ name: "Deals", fields: [{ name: "Name", type: "text" }] });
    model.createRecord("Deals", { Name: "Acme" });
    saveBaseFile("crm", model);

    const reloaded = loadBaseFile("crm");
    expect(reloaded.name).toBe("CRM");
    expect(reloaded.listRecords("Deals")).toHaveLength(1);
  });
});
