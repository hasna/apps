import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Store } from "./store";
import { discover, type CatalogCredentialResolver } from "./catalog";
import { boundedJson } from "./http";
import { Fault, VERSION, parse, idSchema, providerInputSchema, profileInputSchema, runInputSchema, runUpdateSchema, validateHarnessProvider, codingEligible, harnessEligible, type Provider, type Profile, type Run, type Catalog, type LaunchPlan } from "./domain";
import { providerPresets, getProviderPreset } from "./presets";
import openapi from "../openapi.json";
const snapshot=(profile:Profile,provider:Provider,catalog:Catalog)=>createHash("sha256").update(JSON.stringify([profile,provider,{models:catalog.models,source:catalog.source}])).digest("hex");
const hash = (s: string) => createHash("sha256").update(s).digest();
export function createHandler(store: Store, apiKey: string, providerEnv: Record<string, string | undefined> = process.env, resolveCredential?: CatalogCredentialResolver) {
  if (!apiKey || apiKey.length < 24) throw new Fault(500, "auth_config", "Set HASNA_SWITCHER_API_KEY to a random token of at least 24 characters.");
  const expected = hash(`Bearer ${apiKey}`);
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {"x-request-id": requestId, "cache-control": "no-store", "x-content-type-options": "nosniff"}});
    try {
      const url = new URL(request.url); const route = url.pathname.replace(/\/$/, "");
      if (request.method === "GET" && route === "/health") return json({status: "ok", version: VERSION, backend: store.engine});
      if (request.method === "GET" && route === "/version") return json({version: VERSION});
      if (request.method === "GET" && route === "/ready") {
        try { await store.ready(); return json({ready: true}); }
        catch { return json({ready: false, reason: "Storage is unavailable."}, 503); }
      }
      if (!timingSafeEqual(expected, hash(request.headers.get("authorization") ?? ""))) throw new Fault(401, "unauthorized", "A valid API bearer token is required.");
      if (request.method === "GET" && ["/v1/openapi.json", "/openapi.json"].includes(route)) return json(openapi);
      const parts = route.split("/").filter(Boolean);
      if (parts[0] !== "v1") throw new Fault(404, "not_found", "Route was not found.");
      const resource = parts[1]; const id = parts[2];
      if (id) parse(idSchema, id);
      const page = () => parse(z.object({
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        search: z.string().max(200).default(""),
      }).strict(), Object.fromEntries(url.searchParams));
      if (request.method === "GET") {
        if (resource === "provider-presets" && parts.length <= 3) return json(id ? getProviderPreset(id) : {data: providerPresets});
        if (["providers", "profiles", "runs"].includes(resource) && parts.length <= 3) {
          const kind = resource as "providers"|"profiles"|"runs";
          return json(id ? await store.get(kind, id) : await store.list(kind, page()));
        }
        if (resource === "providers" && id && parts[3] === "models" && parts.length === 4) {
          const catalog = await store.get<Catalog>("catalogs", id); const p = page();
          const filtered = catalog.models.filter(m => [m.id, m.name].some(s => s.toLowerCase().includes(p.search.toLowerCase())));
          return json({...catalog, models: undefined, data: filtered.slice(p.offset, p.offset + p.limit).map(m => ({...m, codingEligible: codingEligible(m)})), total: filtered.length, ...p});
        }
        throw new Fault(404, "not_found", "Route was not found.");
      }
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) throw new Fault(405, "method_not_allowed", "Method is not supported.");
      const key = request.headers.get("idempotency-key");
      if (!key || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) throw new Fault(400, "idempotency_required", "Supply an Idempotency-Key of 8–128 ASCII letters, digits, dots, colons, underscores or dashes.");
      let body: any = {};
      if (request.method !== "DELETE") {
        if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Fault(415, "content_type", "Send application/json.");
        try { body = await boundedJson(request, 1024 * 1024); } catch { throw new Fault(400, "invalid_json", "Request must contain valid JSON under 1 MiB."); }
      }
      const fingerprint = hash(JSON.stringify([request.method, route, body, request.headers.get("if-match")])).toString("hex");
      const version = () => {
        const v = request.headers.get("if-match");
        if (!v || !/^[1-9]\d*$/.test(v)) throw new Fault(428, "version_required", "Supply the current numeric version in If-Match.");
        return Number(v);
      };
      const replay = await store.replay(key, fingerprint);
      if (replay.found) return json(replay.value, request.method === "POST" && ["providers", "profiles", "runs"].includes(resource) && !id ? 201 : 200);
      let refreshed: {provider: Provider; catalog: Catalog} | undefined;
      if (resource === "providers" && id && parts[3] === "refresh" && parts.length === 4 && request.method === "POST") {
        parse(z.object({}).strict(), body);
        const provider = await store.get<Provider>("providers", id);
        refreshed = {provider, catalog: await discover(provider, providerEnv, resolveCredential)};
      }
      const result = await store.mutate(key, fingerprint, async db => {
        if ((resource === "providers" || resource === "profiles") && parts.length <= 3) {
          if (request.method === "DELETE" && id) return store.remove(resource, id, version(), db);
          if ((request.method === "POST" && !id) || (request.method === "PUT" && id)) {
            const value = resource === "providers" ? parse(providerInputSchema, body) : parse(profileInputSchema, body);
            if (id && value.id !== id) throw new Fault(400, "id_mismatch", "Path and body IDs must match.");
            if (resource === "profiles") {
              const profile = value as Profile;
              const provider = await store.get<Provider>("providers", profile.providerId, db);
              validateHarnessProvider(profile.harness, provider);
            }
            const saved = await store.put(resource, value, id ? version() : undefined, db);
            if (resource === "providers" && id) await db.unsafe("DELETE FROM switcher_catalogs WHERE id = $1", [id]);
            return saved;
          }
        }
        if (resource === "providers" && id && parts[3] === "refresh" && parts.length === 4 && request.method === "POST") {
          if (store.engine === "postgresql") await db.unsafe("SELECT id FROM switcher_providers WHERE id = $1 FOR SHARE", [id]);
          const provider = await store.get<Provider>("providers", id, db);
          if (!refreshed || provider.version !== refreshed.provider.version) throw new Fault(409, "provider_changed", "Provider changed during discovery; refresh again.");
          const catalog = refreshed.catalog;
          let old: {version: number} | undefined;
          try { old = await store.get("catalogs", id, db); } catch (e) { if (!(e instanceof Fault && e.status === 404)) throw e; }
          return store.put("catalogs", {id, ...catalog}, old?.version, db);
        }
        if (resource === "launch-plans" && !id && request.method === "POST") {
          const {profileId} = parse(z.object({profileId: idSchema}).strict(), body);
          const profile = await store.get<Profile>("profiles", profileId, db);
          const provider = await store.get<Provider>("providers", profile.providerId, db);
          validateHarnessProvider(profile.harness, provider);
          let catalog: Catalog;
          try { catalog = await store.get<Catalog>("catalogs", provider.id, db); }
          catch (e) { if (e instanceof Fault && e.status === 404) throw new Fault(422, "catalog_missing", "Refresh the provider catalog before launching."); throw e; }
          const selected = catalog.models.find(m => m.id === profile.model);
          if (!selected) throw new Fault(422, "model_missing", "Selected model is not in the provider catalog.");
          if (!harnessEligible(selected,profile.harness)) throw new Fault(422, "model_ineligible", "Selected model explicitly lacks text output or tool support.");
          const warnings: string[] = [];
          if (profile.harness!=="aider"&&!selected.supportedParameters) warnings.push("Provider does not declare tool capabilities; execution compatibility is unverified.");
          if (profile.harness === "claude" && !/claude/i.test(profile.model)) warnings.push("Anthropic does not support non-Claude models in Claude Code; this combination is experimental.");
          if (Date.now() - Date.parse(catalog.refreshedAt) > 300000) warnings.push("Catalog snapshot is older than five minutes; refresh before launching.");
          return {profile, provider, catalog, warnings,planToken:snapshot(profile,provider,catalog)} satisfies LaunchPlan;
        }
        if (resource === "runs" && !id && request.method === "POST") {
          const input = parse(runInputSchema, body);
          if(store.engine === "postgresql") await db.unsafe("SELECT id FROM switcher_profiles WHERE id = $1 FOR SHARE",[input.profileId]);
          const profile=await store.get<Profile>("profiles",input.profileId,db);
          if(store.engine === "postgresql") {
            await db.unsafe("SELECT id FROM switcher_providers WHERE id = $1 FOR SHARE",[profile.providerId]);
            await db.unsafe("SELECT id FROM switcher_catalogs WHERE id = $1 FOR SHARE",[profile.providerId]);
          }
          const provider=await store.get<Provider>("providers",profile.providerId,db);
          let catalog:Catalog;
          try{catalog=await store.get<Catalog>("catalogs",profile.providerId,db);}catch(error){if(error instanceof Fault&&error.status===404)throw new Fault(409,"plan_changed","Catalog changed; request a fresh launch plan.");throw error;}
          if (profile.harness !== input.harness || profile.model !== input.model || snapshot(profile,provider,catalog)!==input.planToken) throw new Fault(409, "plan_changed", "Provider, profile or catalog changed; request a fresh launch plan.");
          return store.put("runs", {...input,providerId:provider.id,providerVersion:provider.version,profileVersion:profile.version,id: crypto.randomUUID(), status: "running", startedAt: new Date().toISOString()}, undefined, db);
        }
        if (resource === "runs" && id && request.method === "PATCH" && parts.length === 3) {
          const input = parse(runUpdateSchema, body); const run = await store.get<Run>("runs", id, db);
          if (run.status !== "running") throw new Fault(409, "run_finished", "Run has already finished.");
          return store.put("runs", {...run, ...input, endedAt: new Date().toISOString()}, version(), db);
        }
        throw new Fault(404, "not_found", "Route was not found.");
      });
      return json(result, request.method === "POST" && ["providers", "profiles", "runs"].includes(resource) && !id ? 201 : 200);
    } catch (error) {
      const safe = error instanceof Fault ? error : new Fault(500, "internal_error", "Request failed.");
      return json({error: {code: safe.code, message: safe.message, requestId}}, safe.status);
    }
  };
}
