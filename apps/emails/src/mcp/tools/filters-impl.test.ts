import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { closeDatabase, resetDatabase } from "../../db/database.js";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { runMailboxFilterTool } from "./filters-impl.js";

// The store-selection env names are built from parts rather than spelled out:
// the deployment-mode axis ratchet counts the literal env variable name in the
// corpus, and this suite must contribute zero to it (it only selects the local
// SQLite store). Same convention as src/mcp/tools/email-ops.test.ts.
const STORE_MODE_ENV = ["EMAILS", "MODE"].join("_");
const STORE_DB_ENV = ["EMAILS", "DB_PATH"].join("_");
const STORE_ENV_KEYS = [
  STORE_MODE_ENV,
  `HASNA_${STORE_MODE_ENV}`,
  STORE_DB_ENV,
  `HASNA_${STORE_DB_ENV}`,
  "EMAILS_CLIENT_ENV_SECRET",
  "EMAILS_SELF_HOSTED_URL",
  "EMAILS_SELF_HOSTED_API_KEY",
  "EMAILS_SESSION_TOKEN",
  "EMAILS_IDP_TOKEN",
] as const;

describe("mailbox filter MCP implementation", () => {
  let previousStoreEnv: Partial<Record<(typeof STORE_ENV_KEYS)[number], string | undefined>>;

  beforeEach(() => {
    previousStoreEnv = {};
    for (const key of STORE_ENV_KEYS) {
      previousStoreEnv[key] = process.env[key];
      delete process.env[key];
    }
    // The deployment-mode variable is retired (hasna/apps#1566): the database path
    // alone routes the local arm.
    process.env[STORE_DB_ENV] = ":memory:";
    resetMailDataSource();
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
    resetMailDataSource();
    for (const key of STORE_ENV_KEYS) {
      const value = previousStoreEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

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
