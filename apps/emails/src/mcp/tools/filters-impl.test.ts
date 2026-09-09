import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { runMailboxFilterTool } from "./filters-impl.js";

describe("mailbox filter MCP implementation uses the account API", () => {
  let stub: V1Stub;
  beforeAll(async () => { stub = await startV1Stub({ openapi: true, apiKey: crypto.randomUUID() }); });
  beforeEach(async () => { await stub.reset(); stub.applyEnv(); });
  afterEach(() => stub.clearEnv());
  afterAll(() => stub.stop());

  it("creates without requiring an id, then lists the persisted filter", async () => {
    const created = await runMailboxFilterTool("create_mailbox_filter", {
      name: "Unread support",
      mailbox: "inbox",
      criteria: { unread: true },
    });
    expect(created.isError).toBeUndefined();
    const filter = JSON.parse(created.content[0]!.text) as { id: string; criteria: { unread: boolean } };
    expect(filter.id).toBeString();
    expect(filter.criteria).toEqual({ unread: true });

    const listed = await runMailboxFilterTool("list_mailbox_filters", {});
    expect(JSON.parse(listed.content[0]!.text)).toMatchObject({ items: [filter] });
  });
});
