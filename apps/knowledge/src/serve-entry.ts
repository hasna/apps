#!/usr/bin/env bun
/**
 * @hasna/knowledge — knowledge-serve entrypoint.
 *
 * Boots the HTTP API. Requires the server PostgreSQL URL:
 *   HASNA_KNOWLEDGE_DATABASE_URL=postgres://...      (never logged)
 *   HASNA_KNOWLEDGE_API_SIGNING_KEY=...              (or API_KEY_SIGNING_SECRET)
 *   PORT=8080                                         (optional; default 8080)
 *
 * Self-describing flags (--help, --version) resolve BEFORE any environment
 * work: the serve bin must answer them with no configured database URL
 * (binds-before-args class, same defect family as the projects-serve fix).
 */
import { readFileSync } from 'node:fs';
import { startKnowledgeServe } from './serve.js';

export function handleEarlyArgs(argv: string[]): 'help' | 'version' | 'start' {
  if (argv.includes('--help')) return 'help';
  if (argv.includes('--version')) return 'version';
  return 'start';
}

export function getPackageVersion(): string {
  try {
    // package.json sits one level up from the source entry and from the built bin/.
    const url = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function printHelp(): void {
  console.log(`usage: knowledge-serve [--port <n>]

knowledge-serve — self-hosted HTTP API for @hasna/knowledge.

options:
  --help                show this help and exit
  --version             print the package version and exit
  --port <n>            listen port (default: 8080, or $PORT / HASNA_KNOWLEDGE_SERVE_PORT)
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const early = handleEarlyArgs(argv);
  if (early === 'help') {
    printHelp();
    return;
  }
  if (early === 'version') {
    console.log(getPackageVersion());
    return;
  }

  const running = await startKnowledgeServe();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[knowledge-serve] received ${signal}, shutting down`);
    await running.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('knowledge-serve fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
