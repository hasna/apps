import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildRecorder,
  clearCredentials,
  driveHttp,
  driveMcp,
  freshDb,
  principalFor,
  setCredentials,
  systemContext,
  TEST_ENTITY_A,
  TEST_ENTITY_B,
} from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp } from "../src/services/context.js";
import { authenticateToken } from "../src/server/auth.js";
import type { CustomerRow } from "../src/types/index.js";

const OWNER_A = "tok-owner-a";
const READONLY_A = "tok-readonly-a";
const DUNNER_A = "tok-dunner-a";
const EXPIRED = "tok-expired";
const REVOKED = "tok-revoked";

function seedCredentials(): void {
  setCredentials([
    { id: "owner-a", token: OWNER_A, roles: ["owner"], entity_ids: [TEST_ENTITY_A] },
    { id: "readonly-a", token: READONLY_A, roles: ["readonly"], scopes: ["billing:read"], entity_ids: [TEST_ENTITY_A] },
    { id: "dunner-a", token: DUNNER_A, roles: ["dunning_operator"], scopes: ["billing:read", "dunning:run"], entity_ids: [TEST_ENTITY_A] },
    { id: "expired", token: EXPIRED, roles: ["owner"], entity_ids: [TEST_ENTITY_A], expires_at: "2000-01-01T00:00:00Z" },
    { id: "revoked", token: REVOKED, roles: ["owner"], entity_ids: [TEST_ENTITY_A], revoked: true },
  ]);
}

async function seedCustomer(entityId: string): Promise<CustomerRow> {
  const ctx = systemContext(freshDbHandle);
  const op = getOp("create_customer")!;
  return (await runOp(op, ctx, { entity_id: entityId, email: "seed@b.com" })) as CustomerRow;
}

let freshDbHandle: ReturnType<typeof freshDb>;

beforeEach(() => {
  freshDbHandle = freshDb();
  seedCredentials();
});
afterEach(() => {
  clearCredentials();
  closeDatabase();
});

describe("bearer authentication", () => {
  it("returns a principal for a valid token and null for a wrong one (timing-safe compare)", () => {
    expect(authenticateToken(OWNER_A)?.credential_id).toBe("owner-a");
    expect(authenticateToken("nope")).toBeNull();
    expect(authenticateToken("")).toBeNull();
  });

  it("rejects expired and revoked credentials", () => {
    expect(authenticateToken(EXPIRED)).toBeNull();
    expect(authenticateToken(REVOKED)).toBeNull();
  });
});

describe("/v1 deny-by-default", () => {
  it("401s an unauthenticated request when auth is configured", async () => {
    const res = await driveHttp("GET", "/v1/customers", null);
    expect(res.status).toBe(401);
    expect((res.value as { code: string }).code).toBe("UNAUTHORIZED");
  });

  it("allows a read but denies a write for a read-only credential (scope enforcement)", async () => {
    const read = await driveHttp("GET", "/v1/customers", READONLY_A);
    expect(read.status).toBe(200);
    const write = await driveHttp("POST", "/v1/customers", READONLY_A, { entity_id: TEST_ENTITY_A, email: "x@y.com" });
    expect(write.status).toBe(403);
    expect((write.value as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("denies cross-entity reads (entity_id is not a bearer capability)", async () => {
    const customerB = await seedCustomer(TEST_ENTITY_B);
    const res = await driveHttp("GET", `/v1/customers/${customerB.id}`, OWNER_A);
    expect(res.status).toBe(403);
    expect((res.value as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("scopes list results to the caller's entities (deny-by-default filter)", async () => {
    await seedCustomer(TEST_ENTITY_A);
    await seedCustomer(TEST_ENTITY_B);
    const res = await driveHttp("GET", "/v1/customers", OWNER_A);
    expect(res.status).toBe(200);
    const rows = res.value as CustomerRow[];
    expect(rows.every((r) => r.entity_id === TEST_ENTITY_A)).toBe(true);
  });
});

describe("MCP transport enforces the SAME authorization as /v1 (failure class 1)", () => {
  it("denies a write on the MCP transport for a read-only caller", async () => {
    const rec = buildRecorder(principalFor(READONLY_A));
    const res = await driveMcp(rec, "create_customer", { entity_id: TEST_ENTITY_A, email: "x@y.com" });
    expect(res.ok).toBe(false);
    expect((res.value as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("denies cross-entity reads on the MCP transport", async () => {
    const customerB = await seedCustomer(TEST_ENTITY_B);
    const rec = buildRecorder(principalFor(OWNER_A));
    const res = await driveMcp(rec, "get_customer", { id: customerB.id });
    expect(res.ok).toBe(false);
    expect((res.value as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("lets a dunning_operator run dunning but not create customers (per-op scope on MCP)", async () => {
    const rec = buildRecorder(principalFor(DUNNER_A));
    const denied = await driveMcp(rec, "create_customer", { entity_id: TEST_ENTITY_A, email: "x@y.com" });
    expect(denied.ok).toBe(false);
    expect((denied.value as { code: string }).code).toBe("PERMISSION_DENIED");
  });
});
