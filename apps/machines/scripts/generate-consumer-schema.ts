#!/usr/bin/env bun
// Regenerate the published consumer schema artifact from its TypeScript source of truth.
//
//   bun run scripts/generate-consumer-schema.ts
//
// Output: schemas/machines-consumer.schema.json, serialized from
// MACHINES_CONSUMER_SCHEMA_BUNDLE. The artifact ships in the npm tarball, so it must
// never be hand-edited — every const in it (owner ids, target name, machine ids,
// operation ids) belongs to a named export in src/. test/consumer.test.ts fails if the
// checked-in file drifts from the bundle.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MACHINES_CONSUMER_SCHEMA_BUNDLE } from "../src/consumer-schema.js";
import { MACHINES_CONSUMER_SCHEMA_ARTIFACT } from "../src/topology.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(repoRoot, MACHINES_CONSUMER_SCHEMA_ARTIFACT);

writeFileSync(outPath, `${JSON.stringify(MACHINES_CONSUMER_SCHEMA_BUNDLE, null, 2)}\n`, "utf8");
console.log(`wrote ${outPath}`);
console.log(`envelopes: ${Object.keys(MACHINES_CONSUMER_SCHEMA_BUNDLE.$defs).length}`);
