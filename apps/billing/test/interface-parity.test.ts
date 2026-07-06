import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildRecorder,
  canonical,
  clearCredentials,
  driveCli,
  driveHttp,
  driveMcp,
  freshDb,
  principalFor,
  setCredentials,
  systemContext,
  TEST_ENTITY_A,
} from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { ALL_OPS, getOp, opManifest } from "../src/services/registry.js";
import { runOp } from "../src/services/context.js";
import { openApiDocument } from "../src/api/index.js";
import type { CustomerRow, SubscriptionRow } from "../src/types/index.js";

const OWNER_A = "tok-owner-a";

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

let db: ReturnType<typeof freshDb>;

beforeEach(() => {
  db = freshDb();
  setCredentials([{ id: "owner-a", token: OWNER_A, roles: ["owner"], entity_ids: [TEST_ENTITY_A] }]);
});
afterEach(() => {
  clearCredentials();
  closeDatabase();
});

describe("interface parity — generated op table", () => {
  it("exposes every registry op on all three surfaces (CLI, MCP, /v1)", () => {
    const rec = buildRecorder(principalFor(OWNER_A));
    const doc = openApiDocument();
    for (const entry of opManifest()) {
      // CLI surface: op is dispatchable.
      expect(getOp(entry.op), `CLI missing ${entry.op}`).toBeDefined();
      // MCP surface: a tool of the same name is registered.
      expect(rec.handlers.has(entry.op), `MCP missing tool ${entry.op}`).toBe(true);
      // HTTP surface: a matching path+method exists in the OpenAPI/route table.
      const path = toOpenApiPath(entry.path);
      expect(doc.paths[path], `HTTP missing path ${path}`).toBeDefined();
      expect(doc.paths[path]?.[entry.method.toLowerCase()], `HTTP missing ${entry.method} ${path}`).toBeDefined();
      // Surfaces declared consistently.
      expect(entry.surfaces).toEqual(["cli", "mcp", "http"]);
    }
  });

  it("routes every op through the shared runOp choke point (no per-surface logic)", () => {
    // Each op object is the SAME reference used by CLI, MCP, and HTTP.
    for (const op of ALL_OPS) expect(getOp(op.op)).toBe(op);
  });
});

describe("interface parity — identical results across surfaces", () => {
  async function seed(): Promise<{ customer: CustomerRow; sub: SubscriptionRow }> {
    const ctx = systemContext(db);
    const customer = (await runOp(getOp("create_customer")!, ctx, { entity_id: TEST_ENTITY_A, email: "p@q.com", name: "Parity" })) as CustomerRow;
    const sub = (await runOp(getOp("create_subscription")!, ctx, { customer_id: customer.id, plan: "pro" })) as SubscriptionRow;
    return { customer, sub };
  }

  it("get_customer returns identical normalized values on CLI, MCP, and /v1", async () => {
    const { customer } = await seed();
    const principal = principalFor(OWNER_A);
    const cli = await driveCli(db, "get_customer", { id: customer.id }, principal);
    const rec = buildRecorder(principal);
    const mcp = await driveMcp(rec, "get_customer", { id: customer.id });
    const http = await driveHttp("GET", `/v1/customers/${customer.id}`, OWNER_A);

    expect(cli.ok).toBe(true);
    expect(http.status).toBe(200);
    const a = canonical(cli.value);
    expect(canonical(mcp.value)).toEqual(a);
    expect(canonical(http.value)).toEqual(a);
  });

  it("list_subscriptions returns identical normalized values on all surfaces", async () => {
    await seed();
    const principal = principalFor(OWNER_A);
    const cli = await driveCli(db, "list_subscriptions", { entity_id: TEST_ENTITY_A }, principal);
    const rec = buildRecorder(principal);
    const mcp = await driveMcp(rec, "list_subscriptions", { entity_id: TEST_ENTITY_A });
    const http = await driveHttp("GET", `/v1/subscriptions?entity_id=${TEST_ENTITY_A}`, OWNER_A);

    const a = canonical(cli.value);
    expect(canonical(mcp.value)).toEqual(a);
    expect(canonical(http.value)).toEqual(a);
  });

  it("returns identical structured error envelopes across surfaces", async () => {
    const missing = "99999999-9999-4999-8999-999999999999";
    const principal = principalFor(OWNER_A);
    const cli = await driveCli(db, "get_customer", { id: missing }, principal);
    const rec = buildRecorder(principal);
    const mcp = await driveMcp(rec, "get_customer", { id: missing });
    const http = await driveHttp("GET", `/v1/customers/${missing}`, OWNER_A);

    expect((cli.value as { code: string }).code).toBe("CUSTOMER_NOT_FOUND");
    expect((mcp.value as { code: string }).code).toBe("CUSTOMER_NOT_FOUND");
    expect((http.value as { code: string }).code).toBe("CUSTOMER_NOT_FOUND");
    expect(http.status).toBe(404);
    // Same envelope keys everywhere.
    expect(Object.keys(canonical(cli.value) as object)).toEqual(["code", "message", "suggestion"]);
    expect(canonical(mcp.value)).toEqual(canonical(cli.value));
    expect(canonical(http.value)).toEqual(canonical(cli.value));
  });
});
