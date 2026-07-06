/**
 * Cloud serve bootstrap for @hasna/logs.
 *
 * Resolves the cloud Postgres pool + API-key signing secret from the
 * environment, wires the API-key store (revocation checks against RDS) and
 * returns a Bun server export ({ port, fetch }). Used by `logs-serve` when
 * `HASNA_LOGS_STORAGE_MODE=cloud` (the deployed ECS service). PURE REMOTE
 * (Amendment A1): all reads and writes go straight to RDS.
 */

import { ApiKeyStore } from "@hasna/contracts/auth";
import { createCloudPoolFromEnv } from "../../generated/storage-kit/index.ts";
import { PACKAGE_VERSION } from "../../lib/package-meta.ts";
import { buildCloudApp } from "./app.ts";

export interface CloudServeExport {
  port: number;
  fetch: (request: Request) => Response | Promise<Response>;
}

function resolveSigningSecret(): string {
  const secret =
    process.env.HASNA_LOGS_API_SIGNING_KEY?.trim() ||
    process.env.API_KEY_SIGNING_SECRET?.trim() ||
    process.env.HASNA_API_SIGNING_KEY?.trim();
  if (!secret) {
    throw new Error(
      "cloud serve requires an API-key signing secret. Set HASNA_LOGS_API_SIGNING_KEY " +
        "(or API_KEY_SIGNING_SECRET).",
    );
  }
  return secret;
}

export function buildCloudServe(port: number): CloudServeExport {
  const { client } = createCloudPoolFromEnv("logs", {
    applicationName: "logs-serve",
    max: 10,
  });
  const keys = new ApiKeyStore(client);
  const app = buildCloudApp({
    client,
    version: PACKAGE_VERSION,
    signingSecret: resolveSigningSecret(),
    isRevoked: keys.isRevoked,
    audit: (event) => {
      // Structured per-request auth audit line (no secret material).
      console.log(`api_auth ${JSON.stringify(event)}`);
    },
  });
  console.log(
    `@hasna/logs cloud serve running on http://0.0.0.0:${port} (mode: cloud, api auth: api-key)`,
  );
  return { port, fetch: app.fetch };
}
