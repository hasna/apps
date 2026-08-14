import { glSource } from "../adapters/accounting.js";
import { FIXTURE_ENTITY_RO, FIXTURE_ENTITY_US, entitySource } from "../adapters/entities.js";
import type { Store } from "../db/store.js";
import { groupAccount } from "./group-coa.js";
import { newId } from "./ids.js";

// Seeds the demo consolidation group (entities, FX rates, GL imports, COA
// mappings) so a run over [US, RO] for the period can be computed end-to-end.
// Used by the `demo seed` op and by golden tests.

const US_MAPPINGS: Array<[string, string]> = [
  ["1000", "1000"],
  ["1200", "1200"],
  ["4000", "4000"],
  ["4100", "4100"],
  ["6000", "6000"],
  ["3000", "3000"],
];

const RO_MAPPINGS: Array<[string, string]> = [
  ["1000", "1000"],
  ["2200", "2000"],
  ["6100", "6100"],
  ["7000", "4000"],
  ["6000", "6000"],
  ["1010", "3000"],
];

export interface SeedSummary {
  period: string;
  entities: number;
  fx_rates: number;
  gl_imports: number;
  coa_mappings: number;
  entity_ids: string[];
}

async function seedMappings(store: Store, entityId: string, pairs: Array<[string, string]>): Promise<number> {
  let count = 0;
  for (const [local, group] of pairs) {
    const ga = groupAccount(group);
    if (!ga) continue;
    await store.insert("coa_mappings", {
      id: newId(),
      entity_id: entityId,
      data: {
        entity_id: entityId,
        local_account_code: local,
        group_account_code: group,
        group_account_name: ga.name,
        statement: ga.statement,
        section: ga.section,
      },
    });
    count += 1;
  }
  return count;
}

export async function seedDemo(store: Store, period = "2026-Q1"): Promise<SeedSummary> {
  // Entities (cache).
  const entities = await entitySource().list();
  for (const entity of entities) {
    const data = {
      entity_id: entity.id,
      slug: entity.slug,
      name: entity.name,
      functional_currency: entity.functional_currency,
      country: entity.country,
    };
    const existing = await store.get("entities", entity.id);
    if (existing) await store.update("entities", entity.id, data);
    else await store.insert("entities", { id: entity.id, entity_id: entity.id, data });
  }

  // FX rates: RON -> USD (closing 0.25, average 0.20).
  const rates = [
    { from_currency: "RON", to_currency: "USD", rate: 0.25, rate_type: "closing" as const },
    { from_currency: "RON", to_currency: "USD", rate: 0.2, rate_type: "average" as const },
  ];
  for (const r of rates) {
    await store.insert("fx_rates", { id: newId(), period, data: { period, ...r } });
  }

  // GL imports for the US + RO entities via the accounting adapter.
  const { source, provenance } = glSource();
  const entityIds = [FIXTURE_ENTITY_US, FIXTURE_ENTITY_RO];
  let imports = 0;
  for (const entityId of entityIds) {
    const tb = await source.fetchTrialBalance(entityId, period);
    if (!tb) continue;
    await store.insert("gl_imports", {
      id: newId(),
      entity_id: entityId,
      period,
      data: {
        entity_id: entityId,
        period,
        source: provenance,
        currency: tb.currency,
        status: "imported",
        lines: tb.lines,
        imported_at: new Date().toISOString(),
      },
    });
    imports += 1;
  }

  const mappings =
    (await seedMappings(store, FIXTURE_ENTITY_US, US_MAPPINGS)) +
    (await seedMappings(store, FIXTURE_ENTITY_RO, RO_MAPPINGS));

  return { period, entities: entities.length, fx_rates: rates.length, gl_imports: imports, coa_mappings: mappings, entity_ids: entityIds };
}
