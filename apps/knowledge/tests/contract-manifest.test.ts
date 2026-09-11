import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

interface Surface {
  name: string;
  kind: string;
  status: string;
  authMode: string;
  bin?: string;
  mcpBin?: string;
  exportSubpath?: string;
}

interface Manifest {
  name: string;
  bins: string[];
  description: string;
  serviceSurfaces: Surface[];
  metadata: { client: Record<string, string> };
}

const manifest = JSON.parse(
  readFileSync(new URL('../hasna.contract.json', import.meta.url), 'utf8'),
) as Manifest;

describe('hasna.contract.json client surfaces (hasna/apps#1720)', () => {
  test('every client surface is an api-key surface — hosted-first, fail closed; local only by explicit opt-in', () => {
    const byKind = Object.fromEntries(manifest.serviceSurfaces.map((surface) => [surface.kind, surface]));
    // The CLI and the MCP server resolve a credential through the shared
    // @hasna/contracts chain on every call and FAIL CLOSED without one; the
    // on-box store is reachable only through HASNA_KNOWLEDGE_LOCAL=1 (or an
    // explicit --store). `local-only` would describe the retired behaviour.
    expect(byKind.cli?.authMode).toBe('api-key');
    expect(byKind.mcp?.authMode).toBe('api-key');
    expect(byKind.sdk?.authMode).toBe('api-key');
    expect(byKind.api?.authMode).toBe('api-key');
    expect(byKind.cli?.bin).toBe('knowledge');
    expect(byKind.mcp?.mcpBin).toBe('knowledge-mcp');
    expect(byKind.sdk?.exportSubpath).toBe('./sdk');
  });

  test('one package carries all bins; the client env names and the opt-in are declared', () => {
    expect(manifest.name).toBe('knowledge');
    expect(manifest.bins).toEqual(['knowledge', 'knowledge-mcp', 'knowledge-serve']);
    expect(manifest.metadata.client).toEqual({
      apiUrlEnv: 'HASNA_KNOWLEDGE_API_URL',
      apiKeyEnv: 'HASNA_KNOWLEDGE_API_KEY',
      localOptInEnv: 'HASNA_KNOWLEDGE_LOCAL',
    });
    expect(manifest.description).toContain('FAILS CLOSED');
    expect(manifest.description).toContain('HASNA_KNOWLEDGE_LOCAL=1');
  });
});
