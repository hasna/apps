import { parseArgs } from "node:util";
import { resolveSigningSecret } from "@hasna/contracts/auth";
import { ApiError } from "../api/domain.js";

export function serverConfig(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    host: { type: "string" }, port: { type: "string" }, version: { type: "boolean" }, help: { type: "boolean" },
  } });
  if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== "migrate")) throw new ApiError(400, "invalid_command", "Use trash-serve or trash-serve migrate.");
  if (values.help) return { command: "help" as const };
  if (values.version) return { command: "version" as const };
  const databaseUrl = env.HASNA_TRASH_DATABASE_URL?.trim();
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new ApiError(500, "storage_config", "Set HASNA_TRASH_DATABASE_URL to a PostgreSQL database.");
  if (positionals[0] === "migrate") return { command: "migrate" as const, databaseUrl };
  // hasna-credential-seam-waiver: inbound service signing authority, never an outbound client key.
  const signingSecret = resolveSigningSecret("trash", env, { envName: "HASNA_TRASH_API_SIGNING_KEY" }).value;
  if (Buffer.byteLength(signingSecret) < 32) throw new ApiError(500, "signing_config", "HASNA_TRASH_API_SIGNING_KEY must contain at least 32 bytes.");
  const bucket = env.HASNA_TRASH_S3_BUCKET?.trim(); const region = env.HASNA_TRASH_S3_REGION?.trim();
  if (!bucket || !region) throw new ApiError(500, "object_config", "Set HASNA_TRASH_S3_BUCKET and HASNA_TRASH_S3_REGION.");
  const portText = values.port ?? env.PORT ?? "8080";
  if (!/^[0-9]{1,5}$/.test(portText) || Number(portText) > 65535) throw new ApiError(400, "invalid_port", "Port must be an integer between 0 and 65535.");
  const hostname = values.host ?? "0.0.0.0";
  if (!hostname || /[\x00-\x20\x7f]/.test(hostname)) throw new ApiError(400, "invalid_host", "Configure a valid listening host.");
  return { command: "serve" as const, databaseUrl, signingSecret, hostname, port: Number(portText), s3: { bucket, region } };
}
