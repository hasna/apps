#!/usr/bin/env bun
// Regenerate the typed HTTP SDK (src/sdk/index.ts) from the OpenAPI document
// (src/server/openapi.mjs) using the canonical generator from @hasna/contracts.
//
// The generated client is committed to the repo; test/surfaces-sdk-sync.test.mjs
// asserts the committed file matches a fresh generation, so drift fails CI.
//
//   bun run scripts/generate-sdk.mjs           # write src/sdk/index.ts
//   bun run scripts/generate-sdk.mjs --check    # print, exit non-zero if stale

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateSdkFromOpenApi } from '@hasna/contracts/sdk';
import { buildOpenApiDocument } from '../src/server/openapi.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'src', 'sdk', 'index.ts');

export function renderSdk() {
  // Version is intentionally omitted from the generated source so the SDK is stable
  // across releases (the client is version-agnostic; only the header comment carries it).
  const spec = buildOpenApiDocument({ version: '0.0.0' });
  const { code, warnings } = generateSdkFromOpenApi(spec, { className: 'PersonalNotesClient' });
  if (warnings.length) {
    for (const w of warnings) console.warn(`[generate-sdk] ${w}`);
  }
  return code.endsWith('\n') ? code : code + '\n';
}

if (import.meta.main) {
  const code = renderSdk();
  const check = process.argv.includes('--check');
  if (check) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8');
    } catch {
      /* missing => stale */
    }
    if (current !== code) {
      console.error('src/sdk/index.ts is stale — run `bun run gen:sdk`.');
      process.exit(1);
    }
    console.log('src/sdk/index.ts is up to date.');
  } else {
    writeFileSync(outPath, code);
    console.log(`Wrote ${outPath}`);
  }
}
