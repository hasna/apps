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

  test("reactions table is per-actor rows with FK cascade and per-actor unique toggle key", () => {
    const sql = PG_MIGRATIONS[0].toLowerCase();
    const start = sql.indexOf("create table if not exists reactions");
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf(");", start);
    const table = sql.slice(start, end);
    expect(table).toContain("message_id bigint not null references messages(id) on delete cascade");
    expect(table).toContain("agent text not null");
    expect(table).toContain("emoji text not null");
    expect(table).toContain("created_at");
    // The unique key drives the Slack-style toggle: INSERT ... ON CONFLICT
    // DO NOTHING yields no row for the same (message, agent, emoji), which is
    // how re-adding the same emoji becomes a removal.
    expect(table).toContain("unique(message_id, agent, emoji)");
    // The grouped envelope helper queries by message id in bulk.
    expect(sql).toContain("idx_reactions_message");
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
    expect(pgcrypto).toBeGreaterThan(-1);
    expect(uuidDefault).toBeGreaterThan(pgcrypto);
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

  test("stable channel id migration backfills deterministically and enforces identity", () => {
    expect(PG_MIGRATIONS.length).toBeGreaterThanOrEqual(4);
    const sql = PG_MIGRATIONS[3].toLowerCase();
    expect(sql).toContain("alter table channels add column if not exists id text");
    expect(sql).toContain("hasna-conversations:channel:v1:");
    expect(sql).toContain("digest(");
    expect(sql).toContain("alter column id set not null");
    expect(sql).toContain("add constraint channels_id_unique");
    expect(sql).toContain("unique (id) deferrable initially immediate");
    expect(sql).toContain("create trigger channels_id_immutable");
    expect(sql).toContain("if new.id is distinct from old.id");
    expect(sql).toContain("insert into _migrations (id) values (4)");
  });

  test("project-message linkage receipts are append-only in PostgreSQL", () => {
    expect(PG_MIGRATIONS.length).toBeGreaterThanOrEqual(5);
    const sql = PG_MIGRATIONS[4].toLowerCase();
    expect(sql).toContain("create table if not exists channel_project_linkage_receipts");
    expect(sql).toContain("idempotency_key text not null unique");
    expect(sql).toContain("source_receipt_id text references channel_project_linkage_receipts(id)");
    expect(sql).toContain("before update or delete on channel_project_linkage_receipts");
    expect(sql).toContain("channel project linkage receipts are immutable");
    expect(sql).toContain("insert into _migrations (id) values (5)");
  });

  test("message attachment bytes are added by an incremental PostgreSQL migration", () => {
    expect(PG_MIGRATIONS.length).toBeGreaterThanOrEqual(6);
    const first = PG_MIGRATIONS[0].toLowerCase();
    const sql = PG_MIGRATIONS[5].toLowerCase();

    expect(first).not.toContain("create table if not exists message_attachments");
    expect(sql).toContain("create table if not exists message_attachments");
    expect(sql).toContain("references messages(id) on delete cascade");
    expect(sql).toContain("content bytea not null");
    expect(sql).toContain("primary key (message_id, name)");
    expect(sql).toContain("idx_message_attachments_message");
    expect(sql).toContain("insert into _migrations (id) values (6)");
  });

  test("project channel bind receipts retain prior ownership state", () => {
    const sql = PG_MIGRATIONS.join("\n").toLowerCase();
    expect(sql).toContain("add column if not exists prior_state jsonb");
  });

  test("thread collection migration adds thread_id/thread_status and backfills reply chains", () => {
    const joined = PG_MIGRATIONS.join("\n").toLowerCase();
    expect(joined).toContain("add column if not exists thread_id bigint references messages(id)");
    expect(joined).toContain("add column if not exists thread_status text");
    expect(joined).toContain("idx_messages_thread_id");
    // The backfill walks the reply_to chain to the ROOT (task bf381fad).
    expect(joined).toContain("with recursive thread_chain");
    expect(joined).toContain("update messages set thread_id = thread_chain.root_id");
    expect(joined).toContain("messages.reply_to is not null");
    expect(joined).toContain("messages.thread_id is null");
    expect(joined).toContain("insert into _migrations (id) values (13)");
  });
});
