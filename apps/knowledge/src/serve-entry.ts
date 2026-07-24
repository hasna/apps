#!/usr/bin/env bun
/**
 * @hasna/knowledge — knowledge-serve entrypoint.
 *
 * Stage A boots only public liveness/version/OpenAPI metadata. `/ready` and
 * every data route return typed 403/503 containment before auth, Postgres,
 * schema, provider, or remote transport construction. Cloud credentials and
 * database URLs do not enable hosted access. `PORT` remains optional (8080).
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
