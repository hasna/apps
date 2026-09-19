import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/mcp.js';
import {
  KNOWLEDGE_CORE_TOOL_NAMES,
  resolveKnowledgeMcpProfile,
} from '../src/mcp-profile';

async function connected(profile: 'core' | 'full') {
  const server = buildServer(profile);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: `knowledge-${profile}-profile-test`, version: '0.0.0' });
  await client.connect(clientTransport);
  return { server, client };
}

describe('Knowledge MCP profiles', () => {
  test('resolves core by default and accepts explicit full compatibility', () => {
    expect(resolveKnowledgeMcpProfile([], {})).toBe('core');
    expect(resolveKnowledgeMcpProfile(['--mcp-profile', 'full'], {})).toBe('full');
    expect(resolveKnowledgeMcpProfile(['--mcp-profile=full'], {})).toBe('full');
    expect(resolveKnowledgeMcpProfile([], { HASNA_KNOWLEDGE_MCP_PROFILE: 'full' })).toBe('full');
    expect(() => resolveKnowledgeMcpProfile(['--mcp-profile', 'wide'], {})).toThrow(/expected core or full/);
  });

  test('core exposes only the bounded 18-tool routine inventory and no legacy resources', async () => {
    const { server, client } = await connected('core');
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([...KNOWLEDGE_CORE_TOOL_NAMES].sort());
      expect(names).toHaveLength(18);
      expect(names).toContain('search_tools');
      expect(names).toContain('describe_tools');
      expect(names).toContain('knowledge_context_pack');
      expect(names).not.toContain('ok_delete');
      expect(Buffer.byteLength(JSON.stringify(listed))).toBeLessThan(20_000);

      await expect(client.listResources()).rejects.toThrow(/Method not found/);
      await expect(client.listResourceTemplates()).rejects.toThrow(/Method not found/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('search_tools discovers hidden specialist tools and describe_tools marks activation truthfully', async () => {
    const { server, client } = await connected('core');
    try {
      const searched = await client.callTool({ name: 'search_tools', arguments: { query: 'delete', limit: 20 } });
      const searchText = searched.content?.[0]?.type === 'text' ? searched.content[0].text : '';
      expect(searchText).not.toContain('\n');
      const search = JSON.parse(searchText);
      expect(search.names).toContain('ok_delete');
      expect(search.names).not.toContain('ok_add');
      expect(search.active_profile).toBe('core');

      const described = await client.callTool({ name: 'describe_tools', arguments: { names: ['ok_delete', 'ok_add'] } });
      const describeText = described.content?.[0]?.type === 'text' ? described.content[0].text : '';
      expect(describeText).not.toContain('\n');
      const description = JSON.parse(describeText);
      expect(description.items.find((item: any) => item.name === 'ok_delete')).toMatchObject({ active: false, active_in_core: false });
      expect(description.items.find((item: any) => item.name === 'ok_add')).toMatchObject({ active: true, active_in_core: true });
    } finally {
      await client.close();
      await server.close();
    }
  });

  test('full restores the complete 60-tool and resource inventory', async () => {
    const { server, client } = await connected('full');
    try {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(60);
      expect(listed.tools.some((tool) => tool.name === 'ok_delete')).toBe(true);
      expect(listed.tools.some((tool) => tool.name === 'knowledge_sync_conflict_resolve')).toBe(true);
      expect(listed.tools.some((tool) => tool.name === 'search_tools')).toBe(true);

      // The full-profile stdio integration suite exercises every legacy
      // resource against an explicit local store. This inventory test avoids
      // invoking resource list callbacks, which may resolve the hosted store.
      expect(listed.tools.some((tool) => tool.name === 'knowledge_inventory')).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
