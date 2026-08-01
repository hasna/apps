#!/usr/bin/env bun
/**
 * @hasna/knowledge — knowledge-serve entrypoint.
 *
 * Boots the HTTP API. Requires postgres backend env:
 *   HASNA_KNOWLEDGE_STORAGE_MODE=postgres
 *   HASNA_KNOWLEDGE_DATABASE_URL=postgres://...      (never logged)
 *   HASNA_KNOWLEDGE_API_SIGNING_KEY=...              (or API_KEY_SIGNING_SECRET)
 *   PORT=8080                                         (optional; default 8080)
 */
import { startKnowledgeServe } from './serve.js';

const running = await startKnowledgeServe();

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[knowledge-serve] received ${signal}, shutting down`);
  await running.stop();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
