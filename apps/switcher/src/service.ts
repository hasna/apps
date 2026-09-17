import { canonicalPolicyJSON } from "./model-policy-schema";
import { createHash, timingSafeEqual } from "node:crypto";
import { verifyApiKey, type ApiKeyStatus, type AuthAuditHook } from "@hasna/contracts/auth";
import { z } from "zod";
import { Store } from "./store";
import { discover, type CatalogCredentialResolver } from "./catalog";
import { boundedJson } from "./http";
import { Fault, VERSION, parse, idSchema, providerInputSchema, profileInputSchema, catalogSchema, runInputSchema, runUpdateSchema, validateHarnessProvider, codingEligible, harnessEligible, modelExpired, type Provider, type Profile, type Run, type Catalog, type LaunchPlan } from "./domain";
import { compileModelPolicy } from "./model-policy";
import { providerPresets, getProviderPreset } from "./presets";
import openapi from "../openapi.json";
type StoredCatalog=Catalog&{providerVersion?:number;providerFingerprint?:string};
const providerCatalogFingerprint=(provider:Provider)=>createHash("sha256").update(JSON.stringify(provider)).digest("hex");
const snapshot=(profile:Profile,provider:Provider,catalog:Catalog)=>createHash("sha256").update(JSON.stringify([profile,provider,{models:catalog.models,source:catalog.source}])).digest("hex");
const hash = (s: string) => createHash("sha256").update(s).digest();
export type ServiceAuthentication = string | {
  kind: "signed-api-key";
  signingSecret: string | Buffer;
  keyStatus: (kid: string) => ApiKeyStatus | Promise<ApiKeyStatus>;
  audit?: AuthAuditHook;
};

function localApiKey(headers: Headers) {
  const direct = headers.get("x-api-key");
  if (direct) return direct;
  const authorization = headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

export function createHandler(store: Store, authentication: ServiceAuthentication, providerEnv: Record<string, string | undefined> = process.env, resolveCredential?: CatalogCredentialResolver) {
  const localToken = typeof authentication === "string" ? authentication : undefined;
  if (localToken !== undefined && (localToken.length < 24 || /[\r\n]/.test(localToken)))
    throw new Fault(500, "auth_config", "Set HASNA_SWITCHER_API_KEY to a random token of at least 24 characters.");
  const expected = localToken === undefined ? undefined : hash(localToken);
  const verifier = typeof authentication === "string" ? undefined : verifyApiKey({
    app:"switcher", signingSecret:authentication.signingSecret, keyStatus:authentication.keyStatus,
    ...(authentication.audit ? {audit:authentication.audit} : {}),
  });
  return async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {"x-request-id": requestId, "cache-control": "no-store", "x-content-type-options": "nosniff"}});
    try {
      const url = new URL(request.url); const route = url.pathname.replace(/\/$/, "");
      if (request.method === "GET" && route === "/health") return json({status: "ok", version: VERSION, backend: store.engine});
      if (request.method === "GET" && route === "/version") return json({version: VERSION});
      if (request.method === "GET" && route === "/ready") {
        try { await store.ready(); return json({status:"ready",version:VERSION,backend:store.engine}); }
        catch { return json({status:"unavailable",version:VERSION,backend:store.engine,reason:"Storage is unavailable."}, 503); }
      }
      if (request.method === "GET" && ["/v1/openapi.json", "/openapi.json"].includes(route)) return json(openapi);
      if (expected) {
        const presented = hash(localApiKey(request.headers));
        if (!timingSafeEqual(expected,presented)) throw new Fault(401, "unauthorized", "A valid API key is required.");
      } else {
        const requiredScopes = [request.method === "GET" || request.method === "HEAD" ? "switcher:read" : "switcher:write"];
        const decision = await verifier!.authenticate(request.headers,{method:request.method,path:route,requiredScopes});
        if (!decision.ok) throw new Fault(decision.status,`auth_${decision.reason}`,decision.message);
      }
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
          const catalog = await store.get<StoredCatalog>("catalogs", id); const p = page();
          const filtered = catalog.models.filter(m => [m.id, m.name].some(s => s.toLowerCase().includes(p.search.toLowerCase())));
          return json({...catalog,providerVersion:undefined,providerFingerprint:undefined, models: undefined, data: filtered.slice(p.offset, p.offset + p.limit).map(m => ({...m, codingEligible: codingEligible(m), expired: modelExpired(m)})), total: filtered.length, ...p});
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
      if (!expected && resource === "providers" && id && parts[3] === "refresh" && parts.length === 4 && request.method === "POST")
        throw new Fault(422,"local_catalog_refresh_required","Hosted Switcher never contacts provider URLs. Refresh with the local CLI or MCP client, which authenticates locally and commits catalog metadata only.");
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
          const saved=await store.put("catalogs", {id, ...catalog,providerVersion:provider.version,providerFingerprint:providerCatalogFingerprint(provider)}, old?.version, db);
          return {models:saved.models,refreshedAt:saved.refreshedAt,source:saved.source};
        }
        if (resource === "providers" && id && parts[3] === "catalog" && parts.length === 4 && request.method === "PUT") {
          if(store.engine==="postgresql")await db.unsafe("SELECT id FROM switcher_providers WHERE id = $1 FOR SHARE",[id]);
          const provider = await store.get<Provider>("providers",id,db);
          if(provider.version!==version())throw new Fault(409,"provider_changed","Provider changed during local discovery; refresh again.");
          const catalog=parse(catalogSchema,body);
          const expectedSource=provider.manualModels.length?"manual":"remote";
          if(catalog.source!==expectedSource)throw new Fault(422,"catalog_source_mismatch","Catalog provenance does not match the current provider configuration.");
          catalog.refreshedAt=new Date().toISOString();
          let old:{version:number}|undefined;
          try{old=await store.get("catalogs",id,db);}catch(error){if(!(error instanceof Fault&&error.status===404))throw error;}
          const saved=await store.put("catalogs",{id,...catalog,providerVersion:provider.version,providerFingerprint:providerCatalogFingerprint(provider)},old?.version,db);
          return {models:saved.models,refreshedAt:saved.refreshedAt,source:saved.source};
        }
        if (resource === "launch-plans" && !id && request.method === "POST") {
          const {profileId} = parse(z.object({profileId: idSchema}).strict(), body);
          const profile = await store.get<Profile>("profiles", profileId, db);
          const provider = await store.get<Provider>("providers", profile.providerId, db);
          validateHarnessProvider(profile.harness, provider);
          let catalog: Catalog;
          try { catalog = await store.get<StoredCatalog>("catalogs", provider.id, db); }
          catch (e) { if (e instanceof Fault && e.status === 404) throw new Fault(422, "catalog_missing", "Refresh the provider catalog before launching."); throw e; }
          const stored=catalog as StoredCatalog;
          if((stored.providerVersion!==undefined&&stored.providerVersion!==provider.version)||(stored.providerFingerprint!==undefined&&stored.providerFingerprint!==providerCatalogFingerprint(provider)))
            throw new Fault(409,"catalog_provider_changed","Catalog metadata belongs to an older provider configuration; refresh locally before launching.");
          const selected = catalog.models.find(m => m.id === profile.model);
          if (!selected) throw new Fault(422, "model_missing", "Selected model is not in the provider catalog.");
          if (modelExpired(selected)) throw new Fault(422, "model_expired", "Selected model has passed its configured expiry date. Select an unexpired model.");
          if (!harnessEligible(selected,profile.harness)) throw new Fault(422, "model_ineligible", "Selected model is unavailable or explicitly lacks a required generation method, text output or tool support.");
          compileModelPolicy(profile.model,catalog.models.filter(model=>modelExpired(model)||harnessEligible(model,profile.harness)),profile.modelPolicy);
          const warnings: string[] = [];
          if (profile.harness!=="aider"&&!selected.supportedParameters) warnings.push("Provider does not declare tool capabilities; execution compatibility is unverified.");
          if (profile.harness === "claude" && !/claude/i.test(profile.model)) warnings.push("Anthropic does not support non-Claude models in Claude Code; this combination is experimental.");
          if (Date.now() - Date.parse(catalog.refreshedAt) > 300000) warnings.push("Catalog snapshot is older than five minutes; refresh before launching.");
          return {profile, provider, catalog, warnings,planToken:snapshot(profile,provider,catalog)} satisfies LaunchPlan;
        }
        if (resource === "runs" && !id && request.method === "POST") {
          if((body as {modelPolicyVersion?:unknown})?.modelPolicyVersion!==1)throw new Fault(409,"launcher_upgrade_required","This API requires a launcher with automatic model policy version 1; upgrade the Switcher CLI/SDK.");
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
          if (profile.harness !== input.harness || profile.model !== input.model || canonicalPolicyJSON(profile.modelPolicy ?? null) !== canonicalPolicyJSON(input.modelPolicy ?? profile.modelPolicy ?? null) || snapshot(profile,provider,catalog)!==input.planToken) throw new Fault(409, "plan_changed", "Provider, profile, model policy or catalog changed; request a fresh launch plan.");
          compileModelPolicy(profile.model,catalog.models.filter(model=>modelExpired(model)||harnessEligible(model,profile.harness)),profile.modelPolicy);
          return store.put("runs", {...input,modelPolicy:profile.modelPolicy,providerId:provider.id,providerVersion:provider.version,profileVersion:profile.version,id: crypto.randomUUID(), status: "running", startedAt: new Date().toISOString()}, undefined, db);
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
