import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createWebhook, getWebhook, listWebhooks, deleteWebhook } from "./webhooks.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createWebhook", () => {
  it("should create a webhook with url only", () => {
    const wh = createWebhook({ url: "https://example.com/hook" }, db);
    expect(wh.id).toBeTruthy();
    expect(wh.url).toBe("https://example.com/hook");
    expect(wh.active).toBe(true);
    expect(wh.events).toEqual([]);
    expect(wh.secret).toBeNull();
  });

  it("should create with events and secret", () => {
    const wh = createWebhook({ url: "https://x.com/h", events: ["task.completed"], secret: "s3cr3t" }, db);
    expect(wh.events).toEqual(["task.completed"]);
    expect(wh.secret).toBe("s3cr3t");
  });

  it("should create with multiple events", () => {
    const wh = createWebhook({ url: "https://x.com/h", events: ["task.created", "task.completed", "task.updated"] }, db);
    expect(wh.events).toEqual(["task.created", "task.completed", "task.updated"]);
  });

  it("should generate unique ids", () => {
    const wh1 = createWebhook({ url: "https://a.com" }, db);
    const wh2 = createWebhook({ url: "https://b.com" }, db);
    expect(wh1.id).not.toBe(wh2.id);
  });

  it("should set created_at timestamp", () => {
    const wh = createWebhook({ url: "https://example.com" }, db);
    expect(wh.created_at).toBeTruthy();
  });
});

describe("getWebhook", () => {
  it("should get by id", () => {
    const wh = createWebhook({ url: "https://c.com" }, db);
    const found = getWebhook(wh.id, db);
    expect(found).not.toBeNull();
    expect(found!.url).toBe("https://c.com");
  });

  it("should return null for non-existent", () => {
    expect(getWebhook("nonexistent", db)).toBeNull();
  });

  it("should return correct events as array", () => {
    const wh = createWebhook({ url: "https://x.com", events: ["task.created"] }, db);
    const found = getWebhook(wh.id, db);
    expect(Array.isArray(found!.events)).toBe(true);
    expect(found!.events).toEqual(["task.created"]);
  });

  it("should return active as boolean", () => {
    const wh = createWebhook({ url: "https://x.com" }, db);
    const found = getWebhook(wh.id, db);
    expect(typeof found!.active).toBe("boolean");
    expect(found!.active).toBe(true);
  });
});

describe("listWebhooks", () => {
  it("should list all webhooks", () => {
    createWebhook({ url: "https://a.com" }, db);
    createWebhook({ url: "https://b.com" }, db);
    expect(listWebhooks(db).length).toBe(2);
  });

  it("should return empty array when none exist", () => {
    expect(listWebhooks(db)).toEqual([]);
  });

  it("should return all webhooks", () => {
    createWebhook({ url: "https://first.com" }, db);
    createWebhook({ url: "https://second.com" }, db);
    const webhooks = listWebhooks(db);
    const urls = webhooks.map(w => w.url);
    expect(urls).toContain("https://first.com");
    expect(urls).toContain("https://second.com");
  });
});

describe("deleteWebhook", () => {
  it("should delete a webhook and return true", () => {
    const wh = createWebhook({ url: "https://d.com" }, db);
    expect(deleteWebhook(wh.id, db)).toBe(true);
    expect(listWebhooks(db).length).toBe(0);
  });

  it("should return false for non-existent", () => {
    expect(deleteWebhook("nonexistent", db)).toBe(false);
  });

  it("should only delete the specified webhook", () => {
    const wh1 = createWebhook({ url: "https://keep.com" }, db);
    const wh2 = createWebhook({ url: "https://delete.com" }, db);
    deleteWebhook(wh2.id, db);
    expect(listWebhooks(db).length).toBe(1);
    expect(getWebhook(wh1.id, db)).not.toBeNull();
  });

  it("should not be retrievable after deletion", () => {
    const wh = createWebhook({ url: "https://gone.com" }, db);
    deleteWebhook(wh.id, db);
    expect(getWebhook(wh.id, db)).toBeNull();
  });
});
