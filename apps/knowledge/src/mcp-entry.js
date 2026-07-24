#!/usr/bin/env bun

import { once } from 'node:events';
import { resolveScopedWorkspace } from './workspace.ts';
import {
  containmentErrorFor,
  readKnowledgeConfiguredMode,
  resolveKnowledgeRuntimeRoleWithConfig,
} from './runtime-role.ts';

export function wantsHttp(argv, env) {
  if (argv.includes('--http')) return true;
  const transport = (env.KNOWLEDGE_MCP_TRANSPORT ?? env.HASNA_MCP_TRANSPORT ?? '').trim().toLowerCase();
  return transport === 'http'
    || transport === 'streamable-http'
    || env.KNOWLEDGE_MCP_HTTP === '1'
    || env.MCP_HTTP === '1';
}

export async function mainKnowledgeMcpEntry(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes('-h') || argv.includes('--help')) {
    console.error(`Usage: knowledge-mcp [options]\n\nOptions:\n  --http\n  --port <number>\n  -h, --help`);
    return;
  }
  if (wantsHttp(argv, env)) {
    const runtime = resolveKnowledgeRuntimeRoleWithConfig({
      surface: 'mcp-http',
      env,
    }, () => readKnowledgeConfiguredMode(resolveScopedWorkspace('project').configPath));
    if (runtime.role !== 'local') {
      const error = containmentErrorFor(runtime);
      console.error(JSON.stringify(error.toJSON()));
      process.exitCode = 1;
      return;
    }
    const { resolveMcpHttpPort, startMcpHttpServer } = await import('./mcp-http.js');
    const payloadPath = '../dist/mcp-payload.js';
    const { buildServer } = await import(payloadPath);
    const handle = await startMcpHttpServer(() => buildServer({
      surface: 'mcp-http',
      env,
      scope: 'project',
      cwd: process.cwd(),
    }), {
      host: '127.0.0.1',
      port: resolveMcpHttpPort(argv, env),
      env,
      scope: 'project',
      cwd: process.cwd(),
    });
    console.error(`knowledge MCP HTTP listening on http://${handle.host}:${handle.port}/mcp`);
    await Promise.race([once(process, 'SIGINT'), once(process, 'SIGTERM')]);
    await handle.close();
    return;
  }

  const runtime = resolveKnowledgeRuntimeRoleWithConfig({
    surface: 'mcp-stdio',
    env,
  }, () => readKnowledgeConfiguredMode(resolveScopedWorkspace('project').configPath));
  if (runtime.role !== 'local') {
    const error = containmentErrorFor(runtime);
    console.error(JSON.stringify(error.toJSON()));
    process.exitCode = 1;
    return;
  }

  // This payload is emitted separately. The tiny launcher can therefore deny
  // hosted intent before pg or MCP SDK packages are evaluated.
  const payloadPath = '../dist/mcp-payload.js';
  const { main } = await import(payloadPath);
  await main();
}

if (import.meta.main) {
  mainKnowledgeMcpEntry().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
