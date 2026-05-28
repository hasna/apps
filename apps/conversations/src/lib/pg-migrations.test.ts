import { describe, test, expect } from "bun:test";
import { PG_MIGRATIONS } from "./pg-migrations";

describe("PG_MIGRATIONS", () => {
  test("exports at least one migration", () => {
    expect(PG_MIGRATIONS.length).toBeGreaterThan(0);
  });

  test("each migration is a non-empty SQL string", () => {
    for (const migration of PG_MIGRATIONS) {
      expect(typeof migration).toBe("string");
      expect(migration.length).toBeGreaterThan(0);
    }
  });

  test("first migration creates core tables", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    expect(sql).toContain("create table if not exists projects");
    expect(sql).toContain("create table if not exists spaces");
    expect(sql).toContain("create table if not exists messages");
    expect(sql).toContain("create table if not exists agent_presence");
    expect(sql).toContain("create table if not exists reactions");
    expect(sql).toContain("create table if not exists resource_locks");
    expect(sql).toContain("create table if not exists feedback");
    expect(sql).toContain("create table if not exists _migrations");
  });

  test("first migration creates indexes", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    expect(sql).toContain("create index");
    expect(sql).toContain("idx_projects_name");
    expect(sql).toContain("idx_messages_search");
  });

  test("first migration sets up full-text search", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    expect(sql).toContain("search_vector");
    expect(sql).toContain("tsvector");
    expect(sql).toContain("messages_search_vector_trigger");
  });

  test("first migration inserts migration record", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    expect(sql).toContain("insert into _migrations");
  });
});
