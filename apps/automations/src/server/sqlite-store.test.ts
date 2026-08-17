import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleAutomationSpec } from "../lib/store.js";
import { SqliteServerAutomationsStore } from "./sqlite-store.js";

let dataDir = "";
let store: SqliteServerAutomationsStore;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hasna-automations-server-"));
  process.env.HASNA_AUTOMATIONS_DIR = dataDir;
  store = new SqliteServerAutomationsStore();
});

afterEach(() => {
  delete process.env.HASNA_AUTOMATIONS_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("SqliteServerAutomationsStore.ensureAutomation", () => {
  test("inserts a new automation when the id is absent", async () => {
    const spec = exampleAutomationSpec();
    const installed = await store.ensureAutomation(spec);
    expect(installed.id).toBe(spec.id);
    expect((await store.listAutomations()).length).toBe(1);
  });

  test("is idempotent for identical content and never duplicates the row", async () => {
    const spec = exampleAutomationSpec();
    const first = await store.ensureAutomation(spec);
    const second = await store.ensureAutomation(spec);
    expect(second.id).toBe(first.id);
    expect((await store.listAutomations()).length).toBe(1);
  });

  test("refuses conflicting content without mutating the existing row", async () => {
    const spec = exampleAutomationSpec();
    await store.ensureAutomation(spec);
    const conflicting = exampleAutomationSpec();
    conflicting.version = "2.0.0";
    await expect(store.ensureAutomation(conflicting)).rejects.toThrow(/immutable template installs cannot overwrite/);
    const rows = await store.listAutomations();
    expect(rows.length).toBe(1);
    expect(rows[0].spec.version).toBe("1.0.0");
  });
});
