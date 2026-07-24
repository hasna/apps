// Drift guard: the committed SDK must match a fresh generation from the OpenAPI doc.
// If this fails, run `bun run gen:sdk`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderSdk } from '../scripts/generate-sdk.mjs';

test('src/sdk/index.ts is in sync with the OpenAPI document', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const committed = readFileSync(join(here, '..', 'src', 'sdk', 'index.ts'), 'utf8');
  assert.equal(committed, renderSdk(), 'SDK is stale — run `bun run gen:sdk`');
});
