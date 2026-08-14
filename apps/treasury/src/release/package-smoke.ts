#!/usr/bin/env bun
// Package smoke: prove the core triad surfaces load and operate over an
// in-memory store without a network or cloud. Referenced by `smoke:package`
// and test/package-smoke-script.test.ts.
import { openDatabase } from "../db/database.js";
import { localOwnerContext } from "../services/context.js";
import { createEntity } from "../services/entities.js";
import { recordBalance } from "../services/balances.js";
import { groupRunway } from "../services/runway.js";
import { openApiDocument } from "../api/index.js";
import { buildServer, localOwnerPrincipal } from "../mcp/index.js";
import { createApp } from "../server/app.js";

export interface SmokeResult {
  ok: boolean;
  entity_id: string;
  cash_in_base_minor: number;
  openapi_paths: number;
  mcp_built: boolean;
  serve_built: boolean;
}

export async function runSmoke(): Promise<SmokeResult> {
  const db = await openDatabase({ path: ":memory:" });
  const rc = localOwnerContext(db);
  const entity = await createEntity(rc, { name: "Smoke Co", base_currency: "USD" });
  await recordBalance(rc, { entity_id: entity.entity_id, account_ref: "acct-1", account_kind: "bank", currency: "USD", amount_minor: 100_00 });
  const runway = await groupRunway(rc, { base: "USD" });
  const doc = openApiDocument();
  const mcp = buildServer(localOwnerPrincipal());
  const app = createApp();
  await db.close();
  return {
    ok: true,
    entity_id: entity.entity_id,
    cash_in_base_minor: runway.cash_in_base_minor,
    openapi_paths: Object.keys(doc.paths).length,
    mcp_built: Boolean(mcp),
    serve_built: typeof app.fetch === "function",
  };
}

if (import.meta.main) {
  runSmoke()
    .then((r) => {
      console.log(JSON.stringify(r));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
