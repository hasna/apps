#!/usr/bin/env bun
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb } from "../db/index.ts";
import { resolveServerDataBackend } from "../generated/storage-kit/backend.ts";
import { getBrowserScript } from "../lib/browser-script.ts";
import { getHealth } from "../lib/health.ts";
import { resolvePublicOrigin } from "./request-origin.ts";
import {
  PACKAGE_VERSION,
  exitIfMetadataRequest,
  hasOption,
  readOptionValue,
} from "../lib/package-meta.ts";
import { startScheduler } from "../lib/scheduler.ts";
import {
  getConfiguredApiToken,
  isLocalOpenModeEnabled,
  requireApiTokenOrBrowserIngest,
} from "./auth.ts";
import { buildCloudServe } from "./cloud/serve.ts";
import { resolveCorsOrigin } from "./cors.ts";
import { alertsRoutes } from "./routes/alerts.ts";
import { eventsRoutes } from "./routes/events.ts";
import { issuesRoutes } from "./routes/issues.ts";
import { jobsRoutes } from "./routes/jobs.ts";
import { logsRoutes } from "./routes/logs.ts";
import { otelRoutes } from "./routes/otel.ts";
import { perfRoutes } from "./routes/perf.ts";
import { projectsRoutes } from "./routes/projects.ts";
import { streamRoutes } from "./routes/stream.ts";
import { testReportsRoutes } from "./routes/test-reports.ts";

exitIfMetadataRequest({
  name: "logs-serve",
  description: "Start the @hasna/logs REST API server.",
  options: [
    "  -p, --port <n>     Port to listen on (default: LOGS_PORT or 3460)",
    "      --token <tok>  Require this API token for /api/* requests",
    "      --local-open   Explicitly allow trusted local loopback API requests without a token",
  ],
});

const portArg = readOptionValue(["--port", "-p"]);
const tokenArg = readOptionValue(["--token"]);
if (tokenArg) process.env.HASNA_LOGS_API_TOKEN = tokenArg;
if (hasOption(["--local-open"])) process.env.HASNA_LOGS_LOCAL_OPEN = "1";

const PORT = Number(
  portArg ?? process.env.LOGS_PORT ?? process.env.PORT ?? 3460,
);
// The serve selects its backend from the environment: HASNA_LOGS_DATABASE_URL
// (or LOGS_DATABASE_URL) present -> a stateless API in front of PostgreSQL —
// no SQLite, no scheduler, API-key auth. Otherwise it serves the local SQLite
// database.
const databaseBackend =
  resolveServerDataBackend("logs", process.env).backend === "postgresql";

function buildLocalServe() {
  const db = getDb();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => resolveCorsOrigin(origin),
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-Logs-Token",
        "X-Logs-Browser-Token",
        "X-Logs-Write-Token",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // Browser tracking script — the script self-reports to the public origin the
  // browser reached this server through. x-forwarded-proto is honored (the
  // api.hasna.com gateway terminates TLS) and every host candidate is
  // sanitized, so a hostile or malformed header can never turn the script URL
  // into an injection payload (see ./request-origin.ts).
  app.get("/script.js", (c) => {
    const origin = resolvePublicOrigin({
      headers: c.req.raw.headers,
      defaultHost: `localhost:${PORT}`,
    }) ?? `http://localhost:${PORT}`;
    c.header("Content-Type", "application/javascript");
    c.header("Cache-Control", "public, max-age=300");
    return c.text(getBrowserScript(origin));
  });

  // API routes
  app.use("/api/*", requireApiTokenOrBrowserIngest(db));
  app.route("/api/logs", logsRoutes(db));
  app.route("/api/logs/stream", streamRoutes(db));
  app.route("/api/events", eventsRoutes(db));
  app.route("/api/test-reports", testReportsRoutes(db));
  app.route("/api/otel", otelRoutes(db));
  app.route("/api/projects", projectsRoutes(db));
  app.route("/api/jobs", jobsRoutes(db));
  app.route("/api/alerts", alertsRoutes(db));
  app.route("/api/issues", issuesRoutes(db));
  app.route("/api/perf", perfRoutes(db));

  app.get("/health", (c) => c.json(getHealth(db)));
  app.get("/version", (c) =>
    c.json({ status: "ok", version: PACKAGE_VERSION }),
  );
  app.get("/ready", (c) =>
    c.json({ status: "ok", version: PACKAGE_VERSION }),
  );
  app.get("/", (c) =>
    c.json({
      service: "@hasna/logs",
      port: PORT,
      status: "ok",
    }),
  );

  // Start scheduler
  startScheduler(db);

  const apiAuthMode = getConfiguredApiToken()
    ? "token"
    : isLocalOpenModeEnabled()
      ? "local-open"
      : "locked";
  console.log(
    `@hasna/logs server running on http://localhost:${PORT} (api auth: ${apiAuthMode})`,
  );

  const serveExport: { port: number; hostname?: string; fetch: typeof app.fetch } = {
    port: PORT,
    fetch: app.fetch,
  };
  // Local-open trusts only loopback peers (see auth.ts); binding the socket to
  // loopback is defense in depth so the server is unreachable from the LAN.
  if (apiAuthMode === "local-open") serveExport.hostname = "127.0.0.1";
  return serveExport;
}

const serveExport = databaseBackend ? buildCloudServe(PORT) : buildLocalServe();

export default serveExport;
