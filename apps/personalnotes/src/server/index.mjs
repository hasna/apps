#!/usr/bin/env bun
// `personalnotes-serve` — the Personal Notes HTTP API server binary.
//
// Boots the hand-rolled fetch router (src/server/router.mjs) on Bun.serve. This is the
// PRIMARY surface: the desktop app, CLI, MCP and generated SDK all speak to it over
// HTTP. API-key auth (HASNA_NOTES_API_KEY) is fail-closed when configured.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRouter } from './router.mjs';

function packageVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? process.env.HASNA_NOTES_PORT ?? 8787);
  const hostname = options.hostname ?? process.env.HASNA_NOTES_HOST ?? '127.0.0.1';
  const version = options.version ?? packageVersion();
  const handle = createRouter({ version, apiKey: options.apiKey });

  if (typeof Bun === 'undefined' || !Bun.serve) {
    throw new Error('personalnotes-serve requires the Bun runtime (Bun.serve).');
  }

  const server = Bun.serve({ port, hostname, fetch: handle });
  return server;
}

// Run when invoked directly (as the bin), not when imported by tests.
if (import.meta.main) {
  const server = startServer();
  const authed = !!process.env.HASNA_NOTES_API_KEY;
  // eslint-disable-next-line no-console
  console.log(
    `personalnotes-serve listening on http://${server.hostname}:${server.port}` +
      ` (auth: ${authed ? 'required' : 'open'})`,
  );
  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
