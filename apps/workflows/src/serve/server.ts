/**
 * HTTP server factory for workflows-serve. Interface layer over
 * WorkflowsService; the bin (src/serve/index.ts) wires args + lifecycle.
 */
import type { WorkflowsService } from "../service.js";
import { createRequestHandler } from "../handlers.js";

export interface WorkflowsServer {
  port: number;
  stop: () => void;
}

export function createWorkflowsServer(service: WorkflowsService): WorkflowsServer {
  const handler = createRequestHandler(service);
  const server = Bun.serve({
    hostname: service.config.host,
    port: service.config.port,
    fetch: handler,
  });
  return {
    port: server.port ?? 0,
    stop: () => {
      server.stop();
    },
  };
}
