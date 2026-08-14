import { describe, expect, test } from "bun:test";
import { mintApiKey, verifyApiKey } from "@hasna/contracts/auth";
import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import { createV1Handler } from "./v1.js";

const SIGNING_MATERIAL = Buffer.alloc(32, 19).toString("hex");
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function assetRow(id: string, orgId: string) {
  return {
    id,
    org_id: orgId,
    company_id: null,
    app: "iapp-monthly-filing",
    kind: "supporting_document",
    classification: "restricted",
    version: 1,
    provenance_type: "monthly_filing",
    provenance_id: `filing-${id}`,
    provenance_ref: null,
    external_references: "[]",
    idempotency_key: null,
    original_name: `${id}.txt`,
    content_type: "text/plain",
    size: 9,
    checksum: "a".repeat(64),
    checksum_algorithm: "sha256",
    storage_provider: "local",
    bucket: "/tmp/files-evidence-tenant-test",
    region: null,
    object_key: `objects/${id}.txt`,
    quarantine_key: null,
    status: "verified",
    scan_status: "skipped",
    retention_until: null,
    retention_policy: "synthetic_records",
    storage_class: null,
    legal_hold: false,
    immutable: true,
    metadata: "{}",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    verified_at: "2026-01-01T00:00:00.000Z",
  };
}

function tenantFixture() {
  const assets = new Map([
    ["asset_a", assetRow("asset_a", TENANT_A)],
    ["asset_b", assetRow("asset_b", TENANT_B)],
  ]);
  const intents = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];

  const executor: PgExecutor = {
    async query(text: string, values: readonly unknown[] = []) {
      const sql = text.trim();
      if (sql.includes("SELECT bindings.tenant_id")) {
        return { rows: [{ tenant_id: TENANT_A }] as never[], rowCount: 1 };
      }
      if (/^UPDATE api_keys SET last_used_at/i.test(sql)) {
        return { rows: [] as never[], rowCount: 0 };
      }
      if (/^INSERT INTO file_assets/i.test(sql)) {
        writes.push("file_assets");
        assets.set(String(values[0]), {
          ...assetRow(String(values[0]), String(values[1])),
          company_id: values[2] ?? null,
          app: String(values[3]),
          kind: String(values[4]),
          classification: String(values[5]),
          version: Number(values[6]),
          provenance_type: String(values[7]),
          provenance_id: String(values[8]),
          provenance_ref: values[9] ?? null,
          external_references: String(values[10]),
          idempotency_key: values[11] ?? null,
          original_name: String(values[12]),
          content_type: String(values[13]),
          size: Number(values[14]),
          checksum: String(values[15]),
          checksum_algorithm: String(values[16]),
          storage_provider: String(values[17]),
          bucket: values[18] ?? null,
          region: values[19] ?? null,
          object_key: String(values[20]),
          quarantine_key: values[21] ?? null,
          retention_until: values[22] ?? null,
          retention_policy: values[23] ?? null,
          storage_class: values[24] ?? null,
          legal_hold: Boolean(values[25]),
          immutable: Boolean(values[26]),
          metadata: String(values[27]),
          status: "pending_upload",
          scan_status: "pending",
          verified_at: null,
        });
        return { rows: [] as never[], rowCount: 1 };
      }
      if (/^SELECT \* FROM file_assets WHERE id = \$1/i.test(sql)) {
        const row = assets.get(String(values[0]));
        return { rows: (row ? [row] : []) as never[], rowCount: row ? 1 : 0 };
      }
      if (/^SELECT \* FROM file_assets WHERE status != 'deleted'/i.test(sql)) {
        const tenant = values.includes(TENANT_A) ? TENANT_A : values.includes(TENANT_B) ? TENANT_B : undefined;
        const rows = [...assets.values()].filter((asset) => tenant === undefined || asset.org_id === tenant);
        return { rows: rows as never[], rowCount: rows.length };
      }
      if (/^INSERT INTO file_upload_intents/i.test(sql)) {
        writes.push("file_upload_intents");
        intents.set(String(values[0]), {
          id: values[0],
          asset_id: values[1],
          method: "PUT",
          expires_at: values[2],
          status: "pending",
          expected_checksum: values[3],
          expected_checksum_algorithm: values[4],
          expected_size: values[5],
          required_headers: values[6],
          metadata: values[7],
          created_at: "2026-01-01T00:00:00.000Z",
          completed_at: null,
        });
        return { rows: [] as never[], rowCount: 1 };
      }
      if (/^SELECT \* FROM file_upload_intents WHERE id = \$1/i.test(sql)) {
        const row = intents.get(String(values[0]));
        return { rows: (row ? [row] : []) as never[], rowCount: row ? 1 : 0 };
      }
      if (/^INSERT INTO file_links/i.test(sql)) {
        writes.push("file_links");
        return { rows: [] as never[], rowCount: 1 };
      }
      if (/^SELECT \* FROM file_links WHERE asset_id = \$1 AND/i.test(sql)) {
        return {
          rows: [{
            id: "link_synthetic",
            asset_id: values[0],
            org_id: values[1] === TENANT_A || values[1] === TENANT_B ? values[1] : TENANT_B,
            company_id: null,
            app: values[1] === TENANT_A || values[1] === TENANT_B ? values[2] : values[1],
            source_type: "filing",
            source_id: "synthetic",
            kind: "supporting_document",
            metadata: "{}",
            created_at: "2026-01-01T00:00:00.000Z",
          }] as never[],
          rowCount: 1,
        };
      }
      if (/^INSERT INTO file_access_events/i.test(sql)) {
        writes.push("file_access_events");
        return { rows: [] as never[], rowCount: 1 };
      }
      if (/^SELECT \* FROM file_access_events WHERE id = \$1/i.test(sql)) {
        return {
          rows: [{
            id: values[0],
            asset_id: "asset_b",
            org_id: TENANT_B,
            company_id: null,
            app: "iapp-monthly-filing",
            actor_id: null,
            action: "verify",
            purpose: null,
            metadata: "{}",
            created_at: "2026-01-01T00:00:00.000Z",
          }] as never[],
          rowCount: 1,
        };
      }
      return { rows: [] as never[], rowCount: 0 };
    },
  };

  const handler = createV1Handler({
    getClient: () => wrapExecutor(executor),
    verifier: verifyApiKey({ app: "files", signingSecret: SIGNING_MATERIAL }),
  });
  const token = mintApiKey({
    app: "files",
    kid: "kid-tenant-a",
    scopes: ["files:read", "files:write"],
    signingSecret: SIGNING_MATERIAL,
  }).token;

  async function request(method: string, path: string, body?: Record<string, unknown>) {
    const req = new Request(`https://files.example.test/v1${path}`, {
      method,
      headers: {
        "x-api-key": token,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handler.handle(req, new URL(req.url));
  }

  return { request, writes };
}

describe("hosted evidence tenant binding", () => {
  test("derives list scope from the authenticated tenant and rejects a cross-tenant query", async () => {
    const fixture = tenantFixture();

    const scoped = await fixture.request("GET", "/evidence/assets");
    expect(scoped?.status).toBe(200);
    expect((await scoped!.json() as Array<{ id: string }>).map(({ id }) => id)).toEqual(["asset_a"]);

    const crossTenant = await fixture.request("GET", `/evidence/assets?org_id=${TENANT_B}`);
    expect(crossTenant?.status).toBe(403);
  });

  test("returns generic not-found for every cross-tenant asset operation without writes", async () => {
    const fixture = tenantFixture();
    const operations = [
      fixture.request("GET", "/evidence/assets/asset_b"),
      fixture.request("POST", "/evidence/assets/asset_b/links", {
        org_id: TENANT_B,
        app: "iapp-monthly-filing",
        source_type: "filing",
        source_id: "synthetic",
        kind: "supporting_document",
      }),
      fixture.request("POST", "/evidence/assets/asset_b/sign-download", { purpose: "synthetic-test" }),
      fixture.request("POST", "/evidence/assets/asset_b/verify"),
    ];

    for (const response of await Promise.all(operations)) {
      expect(response?.status).toBe(404);
      expect(await response!.text()).toContain("Evidence asset not found");
    }
    expect(fixture.writes).toEqual([]);
  });

  test("rejects caller-supplied cross-tenant ownership on create and link", async () => {
    const fixture = tenantFixture();
    const create = await fixture.request("POST", "/evidence/upload-intents", {
      org_id: TENANT_B,
      app: "iapp-monthly-filing",
      kind: "supporting_document",
      original_name: "synthetic.txt",
      content_type: "text/plain",
      size: 9,
      checksum: "a".repeat(64),
    });
    expect(create?.status).toBe(403);

    const link = await fixture.request("POST", "/evidence/assets/asset_a/links", {
      org_id: TENANT_B,
      app: "iapp-monthly-filing",
      source_type: "filing",
      source_id: "synthetic",
      kind: "supporting_document",
    });
    expect(link?.status).toBe(403);
    expect(fixture.writes).toEqual([]);
  });
});
