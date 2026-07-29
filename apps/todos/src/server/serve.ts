import { getPackageVersion } from "../lib/package-version.js";
import { getTodosMode, type TodosMode } from "../runtime-mode.js";
import type { V1RequestDependencies } from "./v1.js";

export interface StartServerOptions {
  host?: string;
}

async function dependenciesFor(mode: TodosMode): Promise<V1RequestDependencies> {
  if (mode === "local") {
    const { createLocalV1Dependencies } = await import("./local.js");
    return createLocalV1Dependencies();
  }
  const cloud = await import("./cloud.js");
  return {
    ensureSchema: cloud.ensureCloudSchema,
    getStorageAdapter: cloud.getCloudStorageAdapter,
    getPrGroupLedger: cloud.getCloudPrGroupLedger,
    getVerifier: cloud.getCloudVerifier,
  };
}

export async function startServer(port: number, options: StartServerOptions = {}): Promise<void> {
  const mode = getTodosMode();
  const dependencies = await dependenciesFor(mode);
  const version = getPackageVersion();
  const server = Bun.serve({
    port,
    hostname: options.host ?? "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ status: "ok", name: "todos", version, mode });
      }
      if (request.method === "GET" && url.pathname === "/version") {
        return Response.json({ name: "todos", version, mode });
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        try {
          await dependencies.ensureSchema?.();
          return Response.json({ status: "ready", version, mode });
        } catch (error) {
          return Response.json(
            { status: "unavailable", version, mode, error: error instanceof Error ? error.message : String(error) },
            { status: 503 },
          );
        }
      }
      if (request.method === "GET" && (url.pathname === "/openapi.json" || url.pathname === "/v1/openapi.json")) {
        const { buildV1OpenApiDocument } = await import("./openapi.js");
        return Response.json(buildV1OpenApiDocument());
      }
      if (url.pathname === "/v1" || url.pathname.startsWith("/v1/")) {
        const { handleV1Request } = await import("./v1.js");
        const response = await handleV1Request(request, url, dependencies);
        if (response) return response;
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  const shutdown = () => server.stop();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(`Todos API running at http://localhost:${server.port ?? port}`);
}
