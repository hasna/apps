import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg, { type QueryResultRow } from "pg";
import type { TypedQueryClient } from "../../generated/storage-kit/index.ts";
import { CloudLogStore } from "./store.ts";

const databaseUrl = process.env.HASNA_LOGS_TEST_DATABASE_URL?.trim();
const describeLive = databaseUrl ? describe : describe.skip;

describeLive("CloudLogStore.statsSummary live PostgreSQL 16", () => {
  let client: pg.Client;
  let typed: TypedQueryClient;
  let queryCount = 0;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE TEMP TABLE logs (
      id text PRIMARY KEY,
      timestamp text NOT NULL,
      project_id text,
      level text NOT NULL,
      service text
    )`);
    typed = {
      async query<T extends QueryResultRow>(
        text: string,
        params?: readonly unknown[],
      ) {
        queryCount += 1;
        const result = await client.query<T>(text, [...(params ?? [])]);
        return {
          rows: result.rows,
          rowCount: result.rowCount ?? result.rows.length,
        };
      },
      async many<T extends QueryResultRow>(
        text: string,
        params?: readonly unknown[],
      ) {
        queryCount += 1;
        return (await client.query<T>(text, [...(params ?? [])])).rows;
      },
      async get<T extends QueryResultRow>(
        text: string,
        params?: readonly unknown[],
      ) {
        queryCount += 1;
        return (
          (await client.query<T>(text, [...(params ?? [])])).rows[0] ?? null
        );
      },
      async one<T extends QueryResultRow>(
        text: string,
        params?: readonly unknown[],
      ) {
        queryCount += 1;
        const rows = (await client.query<T>(text, [...(params ?? [])])).rows;
        if (rows.length !== 1)
          throw new Error(`Expected one row, got ${rows.length}`);
        return rows[0] as T;
      },
      async execute<T extends QueryResultRow>(
        text: string,
        params?: readonly unknown[],
      ) {
        queryCount += 1;
        await client.query<T>(text, [...(params ?? [])]);
      },
    };
  });

  afterAll(async () => {
    await client?.end();
  });

  test("returns one bounded, finite, UTC, snapshot-consistent aggregate", async () => {
    const older = new Date(Date.now() - 2 * 3_600_000);
    const newer = new Date(Date.now() - 3_600_000);
    const olderBasicOffset = new Date(older.getTime() + 2 * 3_600_000)
      .toISOString()
      .replace("Z", "+0200");
    await client.query(
      `INSERT INTO logs (id, timestamp, project_id, level, service) VALUES
        ('a', $1, 'p1', 'info', NULL),
        ('b', $2, 'p1', 'warn', '-'),
        ('c', $2, 'p1', 'error', 'api'),
        ('d', 'not-a-timestamp', 'p1', 'fatal', 'api'),
        ('e', 'infinity', 'p1', 'info', 'api'),
        ('f', '10000-01-01T00:00:00Z', 'p1', 'info', 'api'),
        ('g', '2026-09-17 12:00:00', 'p1', 'info', 'api'),
        ('h', '2026-02-30T12:00:00Z', 'p1', 'info', 'api'),
        ('i', $2, 'p2', 'info', 'other')`,
      [olderBasicOffset, newer.toISOString()],
    );

    queryCount = 0;
    const stats = await new CloudLogStore(typed).statsSummary({
      project_id: "p1",
      days: 2.9,
    });

    expect(queryCount).toBe(1);
    expect(stats.total).toBe(8);
    expect(stats.by_service).toEqual({ api: 6, "-": 2 });
    expect(stats.oldest).toBe(older.toISOString());
    expect(stats.newest).toBe(newer.toISOString());
    expect(
      Object.values(stats.by_day).reduce((sum, count) => sum + count, 0),
    ).toBe(3);
  });
});
