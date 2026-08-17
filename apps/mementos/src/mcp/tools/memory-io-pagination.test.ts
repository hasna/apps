// Regression test (BUG 2796806b remediation cycle one): the MCP `memory_export`
// tool targets up to 10000 rows and must assemble the full population in api
// mode even though the server caps single responses at 1000 rows. Before the
// fix it called `listMemories({limit: 10000})`, which silently returned exactly
// one capped page under the bounded-page contract.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../index.js";
import {
  startMemoriesPageStubProcess,
  waitForMemoriesPageStub,
  type MemoriesPageStubProcess,
} from "../../test-support/memories-page-stub.js";
import {
  API_URL_ENV_KEYS,
  API_KEY_ENV_KEYS,
  DB_PATH_ENV_KEYS,
} from "../../db/api-mode.js";

const ROWS = 1500; // > 1000: must be assembled across two capped pages
let stub: MemoriesPageStubProcess;

beforeAll(async () => {
  stub = startMemoriesPageStubProcess(ROWS);
  await waitForMemoriesPageStub(stub.baseUrl);
  // Sibling test files set MEMENTOS_DB_PATH at module scope; under batched
  // runs the DB_PATH precedence would disable API mode entirely ("not
  // configured"). API mode must win here.
  for (const k of DB_PATH_ENV_KEYS) delete process.env[k];
  process.env[API_URL_ENV_KEYS[0]] = stub.baseUrl;
  process.env[API_KEY_ENV_KEYS[0]] = "test-key";
});

afterAll(() => {
  stub.stop();
  delete process.env[API_URL_ENV_KEYS[0]];
  delete process.env[API_KEY_ENV_KEYS[0]];
  // Restore what the batch's sibling files set, so later files in the same
  // process keep the local-store environment they expect.
  process.env["MEMENTOS_DB_PATH"] = ":memory:";
});

describe("memory_export full population in api mode", () => {
  test("exports the full population from a capped server, not one 1000-row page", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "pagination-test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "memory_export",
        arguments: { format: "json" },
      });
      const text =
        result.content?.find((c) => c.type === "text")?.text ?? "";
      const parsed = JSON.parse(text) as Array<{ id: string }>;
      expect(parsed.length).toBe(ROWS);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
