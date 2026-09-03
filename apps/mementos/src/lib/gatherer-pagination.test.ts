// Regression test (BUG 2796806b remediation cycle one): the training-data
// gatherer must assemble the FULL active population in api mode, even
// though the server caps single responses at 1000 rows. Before the fix it
// called `listMemories({status:"active"})` with no limit, which silently
// returned exactly one capped page under the bounded-page contract.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { gatherTrainingData } from "./gatherer.js";
import {
  startMemoriesPageStubProcess,
  waitForMemoriesPageStub,
  type MemoriesPageStubProcess,
} from "../test-support/memories-page-stub.js";
import {
  API_URL_ENV_KEYS,
  API_KEY_ENV_KEYS,
  DB_PATH_ENV_KEYS,
} from "../db/api-mode.js";

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

describe("gatherTrainingData full population in api mode", () => {
  test("collects the full population from a capped server, not one 1000-row page", async () => {
    const result = await gatherTrainingData();
    // 1500 memories => 2 per-memory examples (recall + save) + 1 category
    // search example. A silent 1000-row page would yield 2001.
    expect(result.count).toBe(1500 * 2 + 1);
  });
});
