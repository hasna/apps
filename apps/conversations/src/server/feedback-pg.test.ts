// Hermetic coverage for the hosted feedback route (`POST /v1/feedback`).

import { describe, expect, test } from "bun:test";
import { saveFeedbackPg } from "./feedback-pg.js";

function makeClient() {
  const inserted: Array<{ sql: string; params: readonly unknown[] }> = [];
  const client = {
    async one<T>(sql: string, params: readonly unknown[] = []): Promise<T> {
      inserted.push({ sql, params });
      if (/INSERT INTO feedback/i.test(sql)) {
        return { id: "feedback-fixture-id" } as T;
      }
      throw new Error(`unexpected one(): ${sql.slice(0, 80)}`);
    },
    async get<T>(sql: string): Promise<T | null> {
      return null as T | null;
    },
    async many<T>(sql: string): Promise<T[]> {
      return [] as T[];
    },
    async query<T>(sql: string): Promise<{ rows: T[]; rowCount: number | null }> {
      return { rows: [], rowCount: 0 };
    },
    async execute(sql: string): Promise<void> {},
  };
  return { client, debug: { get inserted() { return inserted; } } };
}

describe("saveFeedbackPg", () => {
  test("inserts the row and reports sent with the stored id", async () => {
    const { client, debug } = makeClient();
    const result = await saveFeedbackPg(client as never, {
      message: "great tool",
      email: "someone@example.invalid",
      category: "bug",
    });

    expect(result).toEqual({ id: "feedback-fixture-id", sent: true, error: null });
    expect(debug.inserted[0].params[0]).toBe("great tool");
    expect(debug.inserted[0].params[1]).toBe("someone@example.invalid");
    expect(debug.inserted[0].params[2]).toBe("bug");
  });

  test("defaults email and category when absent", async () => {
    const { client, debug } = makeClient();
    await saveFeedbackPg(client as never, { message: "hello" });
    expect(debug.inserted[0].params[1]).toBeNull();
    expect(debug.inserted[0].params[2]).toBe("general");
  });

  test("a blank message refuses", async () => {
    const { client } = makeClient();
    await expect(saveFeedbackPg(client as never, { message: "   " })).rejects.toThrow(/message is required/);
  });
});