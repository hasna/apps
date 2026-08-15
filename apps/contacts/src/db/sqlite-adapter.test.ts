import { afterEach, describe, expect, it } from "bun:test";
import { SqliteAdapter } from "./sqlite-adapter.js";

let db: SqliteAdapter | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("SqliteAdapter", () => {
  it("supports previous varargs parameter binding", () => {
    db = new SqliteAdapter(":memory:");
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, label TEXT)");

    db.run("INSERT INTO items (id, label) VALUES (?, ?)", "a", "alpha");

    expect(db.get("SELECT label FROM items WHERE id = ?", "a")).toMatchObject({ label: "alpha" });
    expect(db.all("SELECT id FROM items WHERE label = ?", "alpha")).toEqual([{ id: "a" }]);
  });

  it("supports array parameter binding", () => {
    db = new SqliteAdapter(":memory:");
    db.exec("CREATE TABLE items (id TEXT PRIMARY KEY, label TEXT)");

    db.run("INSERT INTO items (id, label) VALUES (?, ?)", ["b", "beta"]);

    expect(db.get("SELECT label FROM items WHERE id = ?", ["b"])).toMatchObject({ label: "beta" });
    expect(db.all("SELECT id FROM items WHERE label = ?", ["beta"])).toEqual([{ id: "b" }]);
  });
});
