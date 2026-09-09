import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63);
export const envRefSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
const callbackPath = z.string().regex(/^\/(?!\/)[^?#\\\s]*$/);
const appSchema = z.object({
  name: slugSchema,
  directory: z.string().default("."),
  command: z.string().min(1),
  port: z.number().int().min(1024).max(65535),
  readinessPath: callbackPath.default("/"),
  environments: z.array(slugSchema).min(1).default(["dev"]),
  envRefs: z.record(envRefSchema).default({}),
  publicUrlEnv: z.array(envRefSchema).default(["SERVERS_PUBLIC_URL"]),
  dependencies: z.array(slugSchema).default([]),
  oauth: z.object({ callbackPaths: z.array(callbackPath).min(1), javascriptOrigin: z.boolean().default(true) }).strict().optional(),
}).strict();
export const previewManifestSchema = z.object({
  version: z.literal(1),
  product: slugSchema,
  apps: z.array(appSchema).min(1),
}).strict();
export type PreviewApp = z.infer<typeof appSchema>;
export type PreviewManifest = z.infer<typeof previewManifestSchema>;
export interface LoadedManifest { manifest: PreviewManifest; path: string; root: string }
export interface PreviewIdentity { product: string; app: string; environment: string; name: string }

export function previewKey(identity: PreviewIdentity): string {
  return [identity.product, identity.app, identity.environment, identity.name].map((part) => slugSchema.parse(part)).join("/");
}
export function workerName(key: string): string {
  const parts = key.split("/");
  if (parts.length !== 4) throw new Error("Preview identity must be product/app/environment/name");
  parts.forEach((part) => slugSchema.parse(part));
  return `sp-${parts.join("-").slice(0, 45).replace(/-$/, "")}-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}
export function instanceId(key: string, directory: string, stationId: string): string {
  return createHash("sha256").update(JSON.stringify([key, realpathSync(directory), stationId])).digest("hex").slice(0, 32);
}
export function appDirectory(loaded: LoadedManifest, app: PreviewApp): string {
  if (isAbsolute(app.directory)) throw new Error("App directories must be relative to servers.config.json");
  const target = realpathSync(resolve(loaded.root, app.directory));
  const rel = relative(realpathSync(loaded.root), target);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("App directory must remain inside the manifest repository");
  return target;
}
export function loadPreviewManifest(path = process.cwd()): LoadedManifest {
  let candidate = resolve(path);
  if (!candidate.endsWith(".json")) {
    for (;;) {
      const file = resolve(candidate, "servers.config.json");
      if (existsSync(file)) { candidate = file; break; }
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error("No servers.config.json found; see docs/previews.md for the portable app manifest");
      candidate = parent;
    }
  }
  let manifest: PreviewManifest;
  try { manifest = previewManifestSchema.parse(JSON.parse(readFileSync(candidate, "utf8"))); }
  catch { throw new Error("Invalid servers.config.json: expected version 1, explicit product/apps and environment references only"); }
  const names = new Set(manifest.apps.map((app) => app.name));
  if (names.size !== manifest.apps.length) throw new Error("App names must be unique within a product manifest");
  for (const app of manifest.apps) for (const dependency of app.dependencies) {
    if (!names.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${app.name}`);
  }
  const loaded = { manifest, path: candidate, root: dirname(candidate) };
  manifest.apps.forEach((app) => appDirectory(loaded, app));
  return loaded;
}
export function selectPreviewApps(loaded: LoadedManifest, options: { app?: string; product?: string; environment?: string }): PreviewApp[] {
  const { manifest } = loaded;
  if (Boolean(options.app) === Boolean(options.product)) throw new Error("Specify product/app or --product explicitly");
  if (options.product && options.product !== manifest.product) throw new Error("Requested product does not match this manifest");
  if (options.app && options.app.split("/")[0] !== manifest.product) throw new Error("App scope must be product/app from this manifest");
  const target = options.app?.split("/");
  if (target && (target.length !== 2 || !manifest.apps.some((a) => a.name === target[1]))) throw new Error("Unknown product/app in this manifest");
  const result: PreviewApp[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (app: PreviewApp) => {
    if (visited.has(app.name)) return;
    if (visiting.has(app.name)) throw new Error("App dependency cycle in servers.config.json");
    if (!app.environments.includes(options.environment ?? "dev")) throw new Error(`Environment is not enabled for ${app.name}`);
    visiting.add(app.name);
    for (const name of app.dependencies) visit(manifest.apps.find((item) => item.name === name)!);
    visiting.delete(app.name); visited.add(app.name); result.push(app);
  };
  (target ? [manifest.apps.find((a) => a.name === target[1])!] : manifest.apps).forEach(visit);
  return result;
}
