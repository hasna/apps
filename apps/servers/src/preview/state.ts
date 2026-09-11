import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getDataRoot } from "../paths.js";
import { envRefSchema, slugSchema } from "./config.js";

export const settingsSchema = z.object({
  version: z.literal(1),
  accountId: z.string().regex(/^[a-f0-9]{32}$/i),
  subdomain: slugSchema,
  routerName: slugSchema.default("servers-preview-router"),
  accessTeamDomain: z.string().regex(/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/),
  accessEmails: z.array(z.string().email()).min(1),
  apiTokenEnv: envRefSchema.default("CLOUDFLARE_API_TOKEN"),
  controlTokenEnv: envRefSchema.default("SERVERS_PREVIEW_CONTROL_TOKEN"),
  routerTokenEnv: envRefSchema.default("SERVERS_PREVIEW_ROUTER_TOKEN"),
  gatewayTokenEnv: envRefSchema.default("SERVERS_PREVIEW_GATEWAY_TOKEN"),
  workerLimit: z.number().int().min(2).max(500).default(500),
}).strict();
export type PreviewSettings = z.infer<typeof settingsSchema>;
export interface PreviewStation { id: string; name: string; tunnelId: string; serviceId: string; binding: string; gatewayPort: number }
export interface PreviewLease { key: string; hostname: string; stationId?: string; instanceId?: string; fence: number; expiresAt: number }
export interface LocalPreviewRoute { key: string; instanceId: string; serverId: string; databasePath: string; pid: number; port: number; hostname: string; fence: number; expiresAt: number; readinessPath: string }
export function previewStateDir(): string { return process.env.SERVERS_PREVIEW_STATE_DIR ?? join(getDataRoot(), "preview"); }
export function savePreviewState(name: "settings" | "station", value: PreviewSettings | PreviewStation): void {
  const dir = previewStateDir(); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${name}.json`); const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); renameSync(temporary, file);
}
export function loadPreviewSettings(): PreviewSettings {
  try { return settingsSchema.parse(JSON.parse(readFileSync(join(previewStateDir(), "settings.json"), "utf8"))); }
  catch { throw new Error("Preview setup is missing or invalid; run servers preview setup"); }
}
export function loadPreviewStation(): PreviewStation {
  try {
    return z.object({ id: slugSchema, name: slugSchema, tunnelId: z.string().uuid(), serviceId: z.string().uuid(), binding: z.string().regex(/^STATION_[A-Z0-9_]+$/), gatewayPort: z.number().int().min(1024).max(65535) }).strict().parse(JSON.parse(readFileSync(join(previewStateDir(), "station.json"), "utf8")));
  } catch { throw new Error("Station is not registered; run servers preview station register"); }
}
export function requiredSecret(ref: string, env: NodeJS.ProcessEnv = process.env): string {
  envRefSchema.parse(ref);
  const value = env[ref];
  if (!value || value.length < 32 || /[\r\n]/.test(value)) throw new Error(`Set ${ref} through your secret manager (at least 32 characters)`);
  return value;
}
export function infrastructureSecretRefs(settings: PreviewSettings): string[] {
  return [...new Set([settings.apiTokenEnv, settings.controlTokenEnv, settings.routerTokenEnv, settings.gatewayTokenEnv, "TUNNEL_TOKEN"])];
}
export function routerUrl(settings: PreviewSettings): string { return `https://${settings.routerName}.${settings.subdomain}.workers.dev`; }
export async function previewControl<T = PreviewLease>(settings: PreviewSettings, payload: Record<string, unknown>, request: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await request(`${routerUrl(settings)}/__servers/control`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${requiredSecret(settings.controlTokenEnv)}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000), redirect: "error" });
  } catch { throw new Error("Preview registry is unreachable; check setup, credentials and connectivity"); }
  if (!response.ok) {
    if (response.status === 409) throw new PreviewControlError("Preview ownership conflict; inspect status and use --takeover explicitly", 409);
    if (response.status === 401 || response.status === 403) throw new PreviewControlError("Preview registry authentication failed", response.status);
    if (response.status === 404) throw new PreviewControlError("Preview or station is not registered", 404);
    throw new PreviewControlError(`Preview registry rejected request (HTTP ${response.status})`, response.status);
  }
  return await response.json() as T;
}
export class PreviewControlError extends Error { constructor(message: string, public status: number) { super(message); } }
