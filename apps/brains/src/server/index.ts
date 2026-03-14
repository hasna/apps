// Fellow agents: server/MCP versions now come from package metadata so releases cannot drift.
// HTTP server placeholder for @hasna/brains
// Will expose REST API for model management and training data

import { getPackageVersion } from "../lib/package-metadata.js";

const port = Number(process.env["PORT"] ?? 7020);
const service = "brains";

export function createServerFetchHandler(version = getPackageVersion()) {
  return (req: Request): Response => {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service, version });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };
}

export function startServer(serverPort = port) {
  console.log(`${service} server starting on port ${serverPort}`);
  return Bun.serve({
    port: serverPort,
    fetch: createServerFetchHandler(),
  });
}

if (import.meta.main) {
  startServer();
}
