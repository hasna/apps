import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Parser } from "htmlparser2";
import type { TenantScopedStore } from "./store.js";

export interface TrackingConfig { activeKey: string; keys: Record<string, Buffer>; tenants: Record<string, string[]>; ttlSeconds: number }
export interface TrackingOptions { track_opens: boolean; track_clicks: boolean; tracking_url: string }
interface Claim { tenant: string; message: string; link: string; expires: number }
export interface TrackingDocument { html: string; links: Record<string, { kind: "opened" | "clicked"; target: string | null; token: string }>; expires: number }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));
export function trackingBase(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error("tracking_url must be an approved HTTPS base URL");
  let url: URL; try { url = new URL(value); } catch { throw new Error("tracking_url must be an approved HTTPS base URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("tracking_url must be an approved HTTPS base URL without credentials, query or fragment");
  return url.href.replace(/\/+$/, "");
}
export function readTrackingConfig(env: Record<string, string | undefined> = process.env): TrackingConfig | undefined {
  if (!env.EMAILS_TRACKING_CONFIG) return undefined;
  try {
    const raw = JSON.parse(env.EMAILS_TRACKING_CONFIG);
    const keys: Record<string, Buffer> = Object.create(null), tenants: Record<string, string[]> = Object.create(null);
    if (!raw.keys || !raw.tenants || typeof raw.active_key !== "string") throw new Error();
    for (const [id, value] of Object.entries(raw.keys)) {
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id) || typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
      const key = Buffer.from(value, "base64"); if (key.length !== 32) throw new Error(); keys[id] = key;
    }
    if (!keys[raw.active_key]) throw new Error();
    for (const [tenant, urls] of Object.entries(raw.tenants)) {
      if (!/^[0-9a-f-]{36}$/i.test(tenant) || !Array.isArray(urls) || !urls.length) throw new Error();
      tenants[tenant] = urls.map(trackingBase);
    }
    const ttlSeconds = raw.ttl_seconds ?? 7776000;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 31536000) throw new Error();
    return { activeKey: raw.active_key, keys, tenants, ttlSeconds };
  } catch { throw new Error("EMAILS_TRACKING_CONFIG is invalid; configure active_key, 32-byte base64 keys, tenant HTTPS bases and ttl_seconds (60..31536000)"); }
}
export function resolveTracking(body: Record<string, unknown>, tenant: string, config?: TrackingConfig): TrackingOptions | undefined {
  for (const key of ["track_opens", "track_clicks"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw new Error(`${key} must be a boolean`);
  const requested = body.track_opens === true || body.track_clicks === true;
  if (body.tracking_url !== undefined) { trackingBase(body.tracking_url); if (!requested) throw new Error("tracking_url requires track_opens or track_clicks"); }
  if (!requested) return undefined;
  const allowed = config?.tenants[tenant];
  if (!allowed?.length) throw new Error("Tracking is not configured for this tenant; the server operator must configure EMAILS_TRACKING_CONFIG and public HTTPS routes");
  const base = body.tracking_url === undefined ? allowed[0]! : trackingBase(body.tracking_url);
  if (!allowed.includes(base)) throw new Error("tracking_url is not an approved tracking base for this tenant");
  return { track_opens: body.track_opens === true, track_clicks: body.track_clicks === true, tracking_url: base };
}
function seal(config: TrackingConfig, claim: Claim): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config.keys[config.activeKey]!, iv);
  cipher.setAAD(Buffer.from(`emails-tracking:v1:${config.activeKey}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(claim)), cipher.final()]);
  return `${config.activeKey}.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}
export function openTrackingToken(config: TrackingConfig, token: string, now = Date.now()): Claim | null {
  try {
    if (token.length > 2048 || !/^[\w-]{1,32}\.[\w-]+$/.test(token)) return null;
    const [id, value] = token.split("."), key = config.keys[id!]; if (!key) return null;
    const bytes = Buffer.from(value!, "base64url"); if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(`emails-tracking:v1:${id}`)); decipher.setAuthTag(bytes.subarray(12,28));
    const claim = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (typeof claim.tenant !== "string" || !/^[0-9a-f-]{36}$/i.test(claim.tenant) || typeof claim.message !== "string" || typeof claim.link !== "string" || !Number.isFinite(claim.expires) || claim.expires <= now) return null;
    return claim;
  } catch { return null; }
}
export function renderTracking(config: TrackingConfig, options: TrackingOptions, tenant: string, message: string, input: {html?: string; text?: string; unsubscribe?: string}, now = Date.now()): TrackingDocument {
  const textHtml = (input.text ?? "").split(/(https?:\/\/[^\s<>]+)/g).map((part, i) => i % 2 && options.track_clicks ? `<a href="${escape(part)}">${escape(part)}</a>` : escape(part)).join("");
  let html = input.html ?? `<pre>${textHtml}</pre>`;
  const expires = now + config.ttlSeconds * 1000, links: TrackingDocument["links"] = Object.create(null);
  const urlFor = (kind: "opened" | "clicked", target: string | null) => {
    const link = randomBytes(16).toString("hex"), token = seal(config, {tenant,message,link,expires});
    links[link] = { kind, target, token };
    return `${options.tracking_url}/v1/tracking/${token}`;
  };
  if (options.track_clicks) {
    const edits: Array<{start:number;end:number;value:string}> = [];
    const parser = new Parser({ onopentag(name, attrs) {
      if (name !== "a" || !attrs.href || /\bunsubscribe\b/i.test(attrs.rel ?? "") || attrs.href === input.unsubscribe) return;
      let target: URL; try { target = new URL(attrs.href); } catch { return; }
      if (!["http:","https:"].includes(target.protocol) || target.username || target.password) return;
      if (input.unsubscribe) { try { if (new URL(input.unsubscribe).href === target.href) return; } catch {} }
      if (Object.keys(links).length >= 500) throw new Error("Tracked email exceeds 500 links");
      // Rebuild only the opening anchor; the parser decodes entities and handles all quote styles.
      const rewritten = urlFor("clicked", target.href);
      const attributes = Object.entries({...attrs, href: rewritten}).map(([key,value]) => `${key}="${escape(value)}"`).join(" ");
      edits.push({start:parser.startIndex,end:parser.endIndex+1,value:`<a ${attributes}>`});
    } }, { decodeEntities: true });
    parser.write(html); parser.end();
    for (const edit of edits.reverse()) html = html.slice(0,edit.start)+edit.value+html.slice(edit.end);
  }
  if (options.track_opens) {
    const pixel = `<img src="${escape(urlFor("opened", null))}" width="1" height="1" alt="" style="display:none" />`;
    html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${pixel}</body>`) : html + pixel;
  }
  return {html,links,expires};
}
export async function serveTracking(config: TrackingConfig | undefined, token: string, store: (tenant: string) => TenantScopedStore): Promise<Response> {
  const headers = {"Cache-Control":"no-store, max-age=0", "Referrer-Policy":"no-referrer", "X-Content-Type-Options":"nosniff"};
  const claim = config && openTrackingToken(config,token);
  if (!claim) return new Response(null,{status:404,headers});
  const target = await store(claim.tenant).observeTracking(claim.message,claim.link,token);
  if (!target) return new Response(null,{status:404,headers});
  if (target.kind === "clicked") return new Response(null,{status:302,headers:{...headers,Location:target.target!}});
  return new Response(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64"),{headers:{...headers,"Content-Type":"image/gif"}});
}
