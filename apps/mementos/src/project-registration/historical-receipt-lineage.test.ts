process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getDatabase, resetDatabase } from "../db/database.js";
// Ported from iapp-mementos 49113a8. ROOT_TENANT_ID inlined (source:
// ../db/tenancy.js, absent from the monorepo home).
const ROOT_TENANT_ID = "adfd95c7-ee8b-52cb-ae47-4ae65dae3313" as const;
import type { DbAdapter } from "../storage.js";
import {
  createLocalMementosProjectRegistrationAuthority,
  digestMementosProjectRegistrationValue,
  MementosProjectRegistrationError,
  type MementosProjectRegistrationLookupRequest,
  type MementosProjectRegistrationRequest,
} from "./index.js";
import {
  FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY,
  FLEET_RESOURCES_HISTORICAL_LOOKUP_IDENTITY,
  FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION as historical,
  FLEET_RESOURCES_HISTORICAL_RECEIPT,
} from "./historical-receipt.js";

class OwnedPathHandle {
  constructor(private readonly value: string) {}

  withOwnedPath<T>(consumer: (absolutePath: string) => T): T {
    return consumer(this.value);
  }
}

function rootPostgresAuthority(
  db: DbAdapter = getDatabase(),
  overrides: Partial<typeof FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY> = {},
) {
  return createLocalMementosProjectRegistrationAuthority(db, {
    packageVersion: historical.package_version,
    authorityId: overrides.authority_id
      ?? FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY.authority_id,
    tenantId: overrides.tenant_id
      ?? FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY.tenant_id,
    corpusId: overrides.corpus_id
      ?? FLEET_RESOURCES_CURRENT_PROJECT_REGISTRATION_IDENTITY.corpus_id,
  });
}

function insertHistoricalReceipt(
  db: DbAdapter,
  overrides: Record<string, unknown> = {},
): void {
  const row = {
    ...FLEET_RESOURCES_HISTORICAL_RECEIPT,
    target_selector: historical.target_selector,
    normalized_call_digest: "a".repeat(64),
    ...overrides,
  };
  db.run(`
    INSERT INTO mementos_project_registration_receipts (
      receipt_id, authority, route, package_version, authority_id, tenant_id,
      corpus_id, operation_id, step_id, resource_kind, direction,
      target_selector, idempotency_key, request_digest, precondition_digest,
      normalized_call_digest, outcome, reason, target_id, result_revision,
      result_digest, duplicate_of_receipt_id, accepted_receipt_id,
      created_by_operation, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  row.receipt_id,
  row.authority,
  row.route,
  row.package_version,
  row.authority_id,
  row.tenant_id,
  row.corpus_id,
  row.operation_id,
  row.step_id,
  row.resource_kind,
  row.direction,
  row.target_selector,
  row.idempotency_key,
  row.request_digest,
  row.precondition_digest,
  row.normalized_call_digest,
  row.outcome,
  row.reason,
  row.target_id,
  row.result_revision,
  row.result_digest,
  row.duplicate_of_receipt_id,
  row.accepted_receipt_id,
  row.created_by_operation,
  row.created_at,
  );
}

function historicalLookup(
  overrides: Partial<MementosProjectRegistrationLookupRequest> = {},
): MementosProjectRegistrationLookupRequest {
  const source = FLEET_RESOURCES_HISTORICAL_LOOKUP_IDENTITY.source;
  return {
    operation_id: source.operation_id,
    step_id: source.step_id,
    resource_kind: source.resource_kind,
    direction: source.direction,
    authority: source.authority,
    authority_route: source.authority_route,
    package_version: source.package_version,
    authority_id: source.authority_id,
    tenant_id: source.tenant_id,
    corpus_id: source.corpus_id,
    target_selector: source.target_selector,
    target_id: source.target_id,
    idempotency_key: source.idempotency_key,
    max_items: 1,
    response_byte_limit: 131_072,
    time_budget_ms: 10_000,
    ...overrides,
  };
}

function legacyWriteRequest(
  direction: "forward" | "inverse",
): MementosProjectRegistrationRequest {
  const projectPath = "/tmp/fleet-resources-lineage-closed";
  const desired = direction === "forward"
    ? {
        source_project_id: historical.target_selector,
        source_project_slug: "fleet-resources",
        name: "Fleet Resources",
        target_path_digest: createHash("sha256").update(projectPath).digest("hex"),
      }
    : {
        accepted_receipt_id: historical.receipt_id,
        target_id: historical.target_id,
      };
  return {
    operation_id: historical.operation_id,
    step_id: historical.step_id,
    resource_kind: "project",
    direction,
    authority_route: historical.authority_route,
    package_version: historical.package_version,
    authority_id: historical.authority_id,
    tenant_id: historical.tenant_id,
    corpus_id: historical.corpus_id,
    target_selector:
      direction === "forward" ? historical.target_selector : historical.target_id,
    idempotency_key: historical.idempotency_key,
    request_digest: digestMementosProjectRegistrationValue(desired),
    precondition_digest: historical.precondition_digest,
    project_id: historical.target_selector,
    project_slug: "fleet-resources",
    project_name: "Fleet Resources",
    desired,
    target: new OwnedPathHandle(projectPath),
    accepted_receipt:
      direction === "inverse" ? FLEET_RESOURCES_HISTORICAL_RECEIPT : undefined,
    response_byte_limit: 131_072,
    time_budget_ms: 10_000,
  };
}

beforeEach(() => {
  resetDatabase();
});

describe("exact historical project-registration receipt lineage", () => {
  test("the authenticated root PostgreSQL capability advertises exactly one lookup-only identity", async () => {
    const capability = await rootPostgresAuthority().capability();

    expect(capability.supported_historical_lookup_identities).toEqual([
      FLEET_RESOURCES_HISTORICAL_LOOKUP_IDENTITY,
    ]);
  });

  test("non-root and non-PostgreSQL authorities advertise no historical identities", async () => {
    const nonRoot = await rootPostgresAuthority(getDatabase(), {
      tenant_id: "tenant-other",
    }).capability();
    const nonPostgres = await rootPostgresAuthority(getDatabase(), {
      corpus_id: "mementos:sqlite",
    }).capability();

    expect(nonRoot.supported_historical_lookup_identities).toEqual([]);
    expect(nonPostgres.supported_historical_lookup_identities).toEqual([]);
  });

  test("the exact legacy tuple reads the original immutable receipt unchanged", async () => {
    const db = getDatabase();
    insertHistoricalReceipt(db);

    const result = await rootPostgresAuthority(db).lookupReceipt(historicalLookup());

    expect(result.receipt).toEqual(FLEET_RESOURCES_HISTORICAL_RECEIPT);
    expect(result.response_control).toMatchObject({
      complete: true,
      truncated: false,
      response_byte_limit: 131_072,
      time_budget_ms: 10_000,
    });
  });

  test.each([
    ["wrong operation", { operation_id: "op-cli-register-wrong" }],
    ["wrong target selector", { target_selector: "wks_005285827590a93b70e6" }],
    ["wrong target id", { target_id: `mm_project_${"b".repeat(40)}` }],
    ["wrong idempotency", { idempotency_key: `prk_${"b".repeat(48)}` }],
    ["missing target id", { target_id: undefined }],
    ["wildcard selector", { target_selector: "*" }],
    ["client-selected tenant", { tenant_id: "tenant-client-selected" }],
    ["client-selected corpus", { corpus_id: "corpus-client-selected" }],
  ] as const)("closes %s instead of widening lineage", async (_name, overrides) => {
    const db = getDatabase();
    insertHistoricalReceipt(db);

    await expect(rootPostgresAuthority(db).lookupReceipt(historicalLookup(overrides)))
      .rejects.toMatchObject<MementosProjectRegistrationError>({
        code: "MEMENTOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
      });
  });

  test("bounded lookup still rejects enumeration", async () => {
    const db = getDatabase();
    insertHistoricalReceipt(db);

    await expect(rootPostgresAuthority(db).lookupReceipt(historicalLookup({
      max_items: 2 as 1,
    }))).rejects.toMatchObject<MementosProjectRegistrationError>({
      code: "MEMENTOS_PROJECT_REGISTRATION_INVALID_BOUNDS",
    });
  });

  test("cross-tenant and non-PostgreSQL authorities cannot consume the legacy tuple", async () => {
    const db = getDatabase();
    insertHistoricalReceipt(db);

    await expect(rootPostgresAuthority(db, {
      tenant_id: "tenant-other",
    }).lookupReceipt(historicalLookup())).rejects.toMatchObject<
      MementosProjectRegistrationError
    >({
      code: "MEMENTOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
    });
    await expect(rootPostgresAuthority(db, {
      corpus_id: "mementos:sqlite",
    }).lookupReceipt(historicalLookup())).rejects.toMatchObject<
      MementosProjectRegistrationError
    >({
      code: "MEMENTOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
    });
  });

  test("a row under the exact tuple must still equal the preserved immutable receipt", async () => {
    const db = getDatabase();
    insertHistoricalReceipt(db, { receipt_id: `mmpr_${"c".repeat(40)}` });

    await expect(rootPostgresAuthority(db).lookupReceipt(historicalLookup()))
      .rejects.toMatchObject<MementosProjectRegistrationError>({
        code: "MEMENTOS_PROJECT_REGISTRATION_RECEIPT_NOT_FOUND",
      });
  });

  test("historical identity is lookup-only: create and inverse remain closed", async () => {
    const registrationAuthority = rootPostgresAuthority();

    await expect(registrationAuthority.create(legacyWriteRequest("forward")))
      .rejects.toMatchObject<MementosProjectRegistrationError>({
        code: "MEMENTOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
      });
    await expect(registrationAuthority.compensate(legacyWriteRequest("inverse")))
      .rejects.toMatchObject<MementosProjectRegistrationError>({
        code: "MEMENTOS_PROJECT_REGISTRATION_CAPABILITY_MISMATCH",
      });
  });

  test("the destination tuple is the authenticated root tenant, not a legacy or client-selected tenant", () => {
    expect(FLEET_RESOURCES_HISTORICAL_LOOKUP_IDENTITY.destination).toEqual({
      authority_id: "mementos",
      tenant_id: ROOT_TENANT_ID,
      corpus_id: "mementos:postgresql",
    });
  });
});
