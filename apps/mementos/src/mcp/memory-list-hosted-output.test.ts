import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";
import {
  API_KEY_ENV_KEYS,
  API_URL_ENV_KEYS,
  DATABASE_URL_ENV_KEYS,
  DB_PATH_ENV_KEYS,
} from "../db/api-mode.js";
import {
  startMemoriesPageStubProcess,
  waitForMemoriesPageStub,
  type MemoriesPageStubProcess,
} from "../test-support/memories-page-stub.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type InternalServer = ReturnType<typeof buildServer> & {
  _registeredTools: Record<string, { handler(args: Record<string, unknown>): Promise<ToolResult> }>;
};

let stub: MemoriesPageStubProcess;
const scratch = mkdtempSync(join(tmpdir(), "mementos-mcp-hosted-list-"));
const previous = new Map<string, string | undefined>();
const keys = [
  ...API_URL_ENV_KEYS,
  ...API_KEY_ENV_KEYS,
  ...DATABASE_URL_ENV_KEYS,
  ...DB_PATH_ENV_KEYS,
  "HASNA_MEMENTOS_LOCAL",
  "MEMENTOS_LOCAL",
  "HOME",
  "HASNA_DATA_HOME",
];

beforeAll(async () => {
  for (const key of keys) previous.set(key, process.env[key]);
  stub = startMemoriesPageStubProcess(3);
  await waitForMemoriesPageStub(stub.baseUrl);
  for (const key of [...DATABASE_URL_ENV_KEYS, ...DB_PATH_ENV_KEYS, "HASNA_MEMENTOS_LOCAL", "MEMENTOS_LOCAL"]) {
    delete process.env[key];
  }
  process.env[API_URL_ENV_KEYS[0]] = stub.baseUrl;
  process.env[API_KEY_ENV_KEYS[0]] = "test-key";
  process.env.HOME = join(scratch, "home");
  process.env.HASNA_DATA_HOME = join(scratch, "data");
});

afterAll(() => {
  stub.stop();
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("memory_list full response on hosted authority", () => {
  test("uses the client-appended /v1 route, follows paging, and creates no local store", async () => {
    const server = buildServer("core") as InternalServer;
    const response = await server._registeredTools.memory_list!.handler({ full: true, limit: 2 });
    const payload = JSON.parse(response.content[0]!.text) as {
      items: Array<{ id: string }>;
      _meta: Record<string, unknown>;
    };
    // The stub serves only /v1/memories, so a successful page proves the client
    // retained canonical client-appended /v1 routing.
    expect(payload.items).toHaveLength(2);
    expect(payload._meta).toMatchObject({
      count: 2,
      offset: 0,
      next_offset: 2,
      has_more: true,
      complete: false,
    });
    expect(existsSync(join(scratch, "data", "mementos.db"))).toBe(false);
    expect(existsSync(join(scratch, "home", ".hasna", "mementos", "mementos.db"))).toBe(false);
  });
});
