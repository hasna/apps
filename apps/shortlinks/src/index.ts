export { ShortlinksDatabase, SQLITE_MIGRATIONS, makeId, now } from "./database.js";
export { ShortlinksStore } from "./store.js";
export { ApiStore, resolveStore, withStore, isLocalOptIn, missingBackendMessage } from "./client-store.js";
// The on-box SQLite store. The CLI/MCP graphs reach it ONLY through the gated
// dynamic import in ./client-store.ts; this library entry (`dist/index.js`) is
// allowed to bind it statically — it is not a fail-closed client surface.
export { LocalStore } from "./local-store.js";
export { CloudShortlinksStore } from "./cloud-store.js";
export type { Store, ListLinksOptions, TotalStats } from "./store-interface.js";
export { PgShortlinksStore, createKitPgAdapter } from "./pg-store.js";
export { SHORTLINKS_MIGRATIONS } from "./db/migrations.js";
export { createServeApp } from "./serve/app.js";
export { buildOpenApiDocument } from "./serve/openapi.js";
export { createShortlinksHandler, serveShortlinks } from "./server.js";
export { createCloudflarePlan, generateWorkerScript, writeWorkerFiles, upsertCloudflareDnsRecord } from "./cloudflare.js";
export { createLocalSetupPlan, registerMachinesDns } from "./local.js";
export { formatShortUrl, getConfigPath, getDataDir, getDatabasePath, loadConfig, normalizeHostname, saveConfig } from "./config.js";
export type { ConfigEnv } from "./config.js";
export { normalizeSlug, randomToken } from "./slug.js";
export { createShortlinksApiClient, resolveShortlinksSdkTransport } from "./sdk/resolve.js";
export type { ResolveShortlinksSdkTransportOptions, ShortlinksSdkTransport } from "./sdk/resolve.js";
export type { AddDomainInput, Click, ClickInput, CreateLinkInput, Domain, Link, LinkStats } from "./types.js";
