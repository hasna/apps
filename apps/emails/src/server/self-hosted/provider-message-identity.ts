import { canonicalRfcMessageId } from "../../lib/reply-headers.js";

export interface ProviderMessageIdentity {
  messageId: string;
  provenance: { source: "resend-retrieval" } | { source: "configured-ses-region-domain"; region: string; domain: string; evidenceSha256: string; verifiedAt: string };
}
interface SesDomainBinding { domain: string; evidence_sha256: string; verified_at: string }

/** No region/domain is inferred. Each configured mapping requires operator evidence. */
export function sesMessageIdentityResolver(env: NodeJS.ProcessEnv, region: string | null): (id: string) => ProviderMessageIdentity | null {
  const text = env.EMAILS_SES_MESSAGE_ID_DOMAINS;
  if (text === undefined) return () => null;
  const invalid = () => new Error("EMAILS_SES_MESSAGE_ID_DOMAINS must be a bounded JSON region map with domain, evidence_sha256 and verified_at for each observed mapping");
  if (Buffer.byteLength(text) > 8192) throw invalid();
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > 32) throw invalid();
  for (const [key, raw] of Object.entries(parsed)) {
    if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
    const value = raw as Record<string, unknown>;
    if (Object.keys(value).some(key => !["domain","evidence_sha256","verified_at"].includes(key)) || typeof value.domain !== "string" || value.domain.length > 253 || !/^[a-z0-9.-]+$/.test(value.domain) || value.domain.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || typeof value.evidence_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.evidence_sha256) || typeof value.verified_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.verified_at) || !Number.isFinite(Date.parse(value.verified_at))) throw invalid();
  }
  const map = parsed as Record<string, SesDomainBinding>;
  const binding = region && Object.hasOwn(map, region) ? map[region] : undefined;
  return id => {
    if (!binding || !region || !/^[a-zA-Z0-9-]{1,255}$/.test(id)) return null;
    return {messageId:`<${id}@${binding.domain}>`,provenance:{source:"configured-ses-region-domain",region,domain:binding.domain,evidenceSha256:binding.evidence_sha256,verifiedAt:binding.verified_at}};
  };
}

/** Resend's supported retrieval API exposes the actual outbound RFC Message-ID. */
export async function readResendMessageIdentity(id: string, apiKey: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ProviderMessageIdentity | null> {
  if (!/^[a-zA-Z0-9-]{1,255}$/.test(id)) return null;
  const response = await fetchImpl(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {headers:{Authorization:`Bearer ${apiKey}`},signal,redirect:"error"});
  if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let bytes=0;
  try {
    while (true) { const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024*1024)throw Error("Provider identity response exceeds the supported bound");chunks.push(part.value); }
    const result=JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,unknown>;
    const messageId=canonicalRfcMessageId(result.message_id);
    if(result.id!==id || !messageId)return null;
    return {messageId,provenance:{source:"resend-retrieval"}};
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
