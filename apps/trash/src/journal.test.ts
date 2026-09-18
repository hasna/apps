import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { OperationJournal, type Operation } from "./journal.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-journal-"))); roots.push(root); return root; }
function operation(root: string): Operation { const id = randomUUID(); return { schema: 1, id, entryId: id, kind: "capture", phase: "snapshotting", stationId: randomUUID(), path: join(root, "source"), createdAt: new Date().toISOString(), attempt: 0 }; }

test("journal records are owner-only, durable, validated and bounded", async () => {
  const root = fixture(); const journal = new OperationJournal(join(root, "ops")); const op = operation(root);
  journal.create(op);
  expect(lstatSync(journal.directory(op.id)).mode & 0o777).toBe(0o700);
  expect(lstatSync(join(journal.directory(op.id), "record.json")).mode & 0o777).toBe(0o600);
  expect(journal.read(op.id)).toEqual(op);
  await journal.lock(op.id, async () => journal.write({ ...op, phase: "captured" }));
  expect(journal.read(op.id).phase).toBe("captured");
  expect(journal.pending()).toEqual([{ id: op.id, entryId: op.id, kind: "capture", phase: "captured", path: op.path }]);
  expect(() => journal.pending(101)).toThrow();
  expect(() => journal.read("../credentials")).toThrow();
  expect(() => journal.create(op)).toThrow();
});

test("journal refuses symlinks and permissions that expose recovery metadata", () => {
  const root = fixture(); const journal = new OperationJournal(join(root, "ops")); const op = operation(root); journal.create(op);
  const record = join(journal.directory(op.id), "record.json"); chmodSync(record, 0o644);
  expect(() => journal.read(op.id)).toThrow(); chmodSync(record, 0o600);
  const bytes = readFileSync(record); rmSync(record); writeFileSync(join(root, "other"), bytes); symlinkSync(join(root, "other"), record);
  expect(() => journal.read(op.id)).toThrow();
  const alias = join(root, "alias"); symlinkSync(join(root, "ops"), alias);
  expect(() => new OperationJournal(alias).create(operation(root))).toThrow();
});

test("completion removes only known operation artifacts and preserves unknown files", () => {
  const root = fixture(); const journal = new OperationJournal(join(root, "ops")); const op = operation(root); journal.create(op);
  writeFileSync(journal.capsule(op.id, 0), "fixture"); writeFileSync(join(journal.directory(op.id), "unrelated"), "keep");
  expect(() => journal.complete(op.id)).toThrow();
  expect(readFileSync(join(journal.directory(op.id), "unrelated"), "utf8")).toBe("keep");
  expect(existsSync(join(journal.directory(op.id), "record.json"))).toBe(true);
  rmSync(join(journal.directory(op.id), "unrelated")); journal.complete(op.id);
  expect(existsSync(journal.directory(op.id))).toBe(false);
});
