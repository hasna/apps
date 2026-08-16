import { describe, expect, test } from "bun:test";
import { collectCompletePages } from "./paginate.js";

describe("complete producer pagination", () => {
  test("refuses duplicate rows instead of deduplicating a possibly missing page", async () => {
    let calls = 0;
    await expect(collectCompletePages(
      async ({ offset }) => {
        calls++;
        if (offset === 0) {
          return { rows: [{ id: "wks_a" }], total: 2, offset, limit: 1, has_more: true };
        }
        return { rows: [{ id: "wks_a" }], total: 2, offset, limit: 1, has_more: false };
      },
      (row) => row.id,
      { pageSize: 1 },
    )).rejects.toThrow(/duplicate row/);
    expect(calls).toBe(2);
  });

  test("refuses an empty non-terminal page instead of claiming complete population", async () => {
    await expect(collectCompletePages(
      async ({ offset }) => {
        if (offset === 0) {
          return { rows: [{ id: "wks_a" }], total: 3, offset, limit: 1, has_more: true };
        }
        return { rows: [], total: 3, offset, limit: 1, has_more: true };
      },
      (row) => row.id,
      { pageSize: 1 },
    )).rejects.toThrow(/empty non-terminal page/);
  });
});
