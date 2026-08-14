import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { configService } from "../src/services/index.js";
import { listSavedViews } from "../src/db/crud.js";
import { verifyAuditChain, listAudit } from "../src/db/audit.js";
import { EntityAccessDeniedError, SavedViewNotFoundError } from "../src/types/index.js";
import { HASNA_INC, ACME_RO } from "../src/adapters/index.js";
import type { ApiPrincipal } from "../src/server/auth.js";
import { cleanupTestDatabase, getDbHelper, ownerCtx, seededDb, useTestDatabase } from "./helpers/database.js";

function restrictedViewer(entityIds: string[], write = false): ApiPrincipal {
  return {
    actor_id: "viewer",
    credential_id: "viewer",
    credential_type: "api_key",
    roles: [write ? "editor" : "viewer"],
    scopes: write ? ["fleet:read", "fleet:write"] : ["fleet:read"],
    entity_ids: entityIds,
  };
}

let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("fleet-config");
  seededDb();
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
});

describe("config service CRUD + audit + scoping", () => {
  it("creates, reads, updates, and deletes a saved view", () => {
    const ctx = ownerCtx();
    const view = configService.createSavedView(ctx, { entity_id: HASNA_INC, name: "Board", kind: "dashboard", spec: { a: 1 } });
    expect(view.entity_slug).toBe("hasna-inc-us");
    expect(configService.getSavedView(ctx, view.id).name).toBe("Board");

    const updated = configService.updateSavedView(ctx, view.id, { name: "Board v2" });
    expect(updated.name).toBe("Board v2");
    expect(updated.version).toBe(2);

    expect(configService.deleteSavedView(ctx, view.id)).toEqual({ id: view.id, deleted: true });
    expect(() => configService.getSavedView(ctx, view.id)).toThrow(SavedViewNotFoundError);
  });

  it("records an append-only audit entry per mutation and stays chain-valid", () => {
    const ctx = ownerCtx();
    const slo = configService.createSlo(ctx, { entity_id: HASNA_INC, target_type: "agent", target_ref: "researcher", name: "avail", objective: "availability", target_value: 99 });
    configService.updateSlo(ctx, slo.id, { target_value: 99.5 });
    const audit = listAudit(getDbHelper());
    expect(audit.some((a) => a.action === "create" && a.resource === "slo")).toBe(true);
    expect(audit.some((a) => a.action === "update" && a.resource === "slo")).toBe(true);
    expect(verifyAuditChain(getDbHelper()).valid).toBe(true);
  });

  it("denies cross-entity create for a restricted principal (§1c)", () => {
    const ctx = ownerCtx(undefined, restrictedViewer([HASNA_INC], true));
    expect(() =>
      configService.createSavedView(ctx, { entity_id: ACME_RO, name: "x", kind: "dashboard" }),
    ).toThrow(EntityAccessDeniedError);
  });

  it("scopes list results to the principal's allowed entities", () => {
    const owner = ownerCtx();
    configService.createSavedView(owner, { entity_id: HASNA_INC, name: "h", kind: "dashboard" });
    configService.createSavedView(owner, { entity_id: ACME_RO, name: "a", kind: "dashboard" });

    const restricted = ownerCtx(undefined, restrictedViewer([HASNA_INC]));
    const list = configService.listSavedViews(restricted);
    expect(list.length).toBe(1);
    expect(list[0]!.entity_id).toBe(HASNA_INC);
  });

  it("scopedRows treats an EMPTY allow-list as deny-by-default (no rows), undefined as all", () => {
    const owner = ownerCtx();
    configService.createSavedView(owner, { entity_id: HASNA_INC, name: "h", kind: "dashboard" });
    configService.createSavedView(owner, { entity_id: ACME_RO, name: "a", kind: "dashboard" });
    const db = getDbHelper();

    // undefined => unconstrained (bypass/SYSTEM path) => every row.
    expect(listSavedViews(db, undefined).length).toBe(2);
    // EMPTY array => constrained-but-empty principal => NO rows (deny-by-default),
    // NOT "all rows". This is the hardened path for an unscoped non-bypass caller.
    expect(listSavedViews(db, [])).toEqual([]);
    // Non-empty allow-list => exactly the scoped rows.
    expect(listSavedViews(db, [HASNA_INC]).map((v) => v.entity_id)).toEqual([HASNA_INC]);
  });

  it("denies a get by id across entities even when the id is known", () => {
    const owner = ownerCtx();
    const view = configService.createSavedView(owner, { entity_id: ACME_RO, name: "secret", kind: "dashboard" });
    const restricted = ownerCtx(undefined, restrictedViewer([HASNA_INC]));
    expect(() => configService.getSavedView(restricted, view.id)).toThrow(EntityAccessDeniedError);
  });
});
