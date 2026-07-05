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
    expect(sql).toContain("create table if not exists channels");
    expect(sql).toContain("create table if not exists messages");
    expect(sql).toContain("create table if not exists agent_presence");
    expect(sql).toContain("create table if not exists reactions");
    expect(sql).toContain("create table if not exists resource_locks");
    expect(sql).toContain("create table if not exists feedback");
    expect(sql).toContain("create table if not exists _migrations");
    expect(sql).toContain("metadata text");
    expect(sql).toContain("tags text");
    const channelsDefinition = sql.slice(
      sql.indexOf("create table if not exists channels"),
      sql.indexOf(");", sql.indexOf("create table if not exists channels")),
    );
    expect(channelsDefinition).not.toContain("parent_id");
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

  test("message-dependent statements run after messages table and channel column exist", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    const createMessages = sql.indexOf("create table if not exists messages");
    const addChannel = sql.indexOf("alter table messages add column if not exists channel");
    const messagesChannelIndex = sql.indexOf("idx_messages_channel");
    const subscriptionBackfill = sql.indexOf("update channel_subscriptions ss");
    expect(createMessages).toBeGreaterThan(-1);
    expect(addChannel).toBeGreaterThan(createMessages);
    expect(messagesChannelIndex).toBeGreaterThan(addChannel);
    expect(subscriptionBackfill).toBeGreaterThan(messagesChannelIndex);
  });

  test("migration initializes pgcrypto before UUID defaults", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    const pgcrypto = sql.indexOf("create extension if not exists pgcrypto");
    const uuidDefault = sql.indexOf("gen_random_uuid()");
    const uuidIndex = sql.indexOf("idx_messages_uuid");
    expect(pgcrypto).toBeGreaterThan(-1);
    expect(uuidDefault).toBeGreaterThan(pgcrypto);
    expect(uuidIndex).toBeGreaterThan(uuidDefault);
  });

  test("legacy PostgreSQL spaces are imported before legacy storage is dropped", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    const mapTable = sql.indexOf("create temp table if not exists __legacy_channel_map");
    const insertChannels = sql.indexOf("insert into channels (name, description, topic, project_id");
    const dropMessageSpace = sql.indexOf("alter table messages drop column if exists space");
    const dropSpaces = sql.indexOf("drop table if exists spaces");

    expect(mapTable).toBeGreaterThan(-1);
    expect(insertChannels).toBeGreaterThan(mapTable);
    expect(dropMessageSpace).toBeGreaterThan(insertChannels);
    expect(dropSpaces).toBeGreaterThan(insertChannels);

    expect(sql).toContain("space_members");
    expect(sql).toContain("space_subscriptions");
    expect(sql).toContain("space_notification_reads");
    expect(sql).toContain("message_mentions");
    expect(sql).toContain("tasks.space");
    expect(sql).toContain("graph_edges.from_type = ''space''");
    expect(sql).toContain("resource_locks.resource_type = ''space''");
    expect(sql).toContain("messages.session_id = ''space:'' || channel_map.legacy_name");
    expect(sql).toContain("to_agent = channel_map.channel_name");
  });

  test("legacy import preserves parent context as metadata and tags, not channel hierarchy", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    expect(sql).toContain("'import_source'");
    expect(sql).toContain("'legacy_space'");
    expect(sql).toContain("'parent_channel'");
    expect(sql).toContain("'legacy-parent:'");
    expect(sql).toContain("alter table channels drop column if exists parent_id");
  });

  test("first migration inserts migration record", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    expect(sql).toContain("insert into _migrations");
  });
});
