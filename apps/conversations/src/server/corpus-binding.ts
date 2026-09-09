import { randomUUID } from "node:crypto";
import type { ApiKeyPrincipal } from "@hasna/contracts/auth";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/query.js";

export interface CorpusBinding {
  corpus_id: string;
  tenant_id: string;
  authority_id: string;
  receipt_id: string;
  actor: string;
  adopted_at: string | Date;
  legacy_receipt_count: string | number;
  legacy_receipt_digest: string;
}
export interface CorpusExpectation { corpus_id?: string; tenant_id?: string; authority_id?: string }
export class CorpusBindingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function corpusExpectationFromEnv(env = process.env): CorpusExpectation {
  const values = [env.HASNA_CONVERSATIONS_CORPUS_ID, env.HASNA_CONVERSATIONS_TENANT_ID, env.HASNA_CONVERSATIONS_AUTHORITY_ID];
  if (values.every(value => value === undefined)) return {};
  if (values.some(value => !value || !identifier.test(value))) throw new CorpusBindingError(503, "Corpus deployment identity requires valid corpus, tenant and authority identifiers.");
  return { corpus_id: values[0], tenant_id: values[1], authority_id: values[2] };
}

export async function readCorpusBinding(client: TypedQueryClient, expected: CorpusExpectation = {}): Promise<CorpusBinding> {
  let row: CorpusBinding | null;
  try { row = await client.get<CorpusBinding>(`SELECT b.corpus_id,b.tenant_id,b.authority_id,b.receipt_id,b.actor,b.adopted_at,b.legacy_receipt_count,b.legacy_receipt_digest
    FROM conversations_corpus_binding b JOIN project_channel_registration_identity i ON i.corpus_id=b.corpus_id
    WHERE b.singleton=TRUE AND i.singleton=TRUE`);
  } catch { throw new CorpusBindingError(503, "Corpus ownership schema is unavailable; apply the reviewed migration before serving requests."); }
  if (!row) throw new CorpusBindingError(503, "Corpus ownership is not initialized. An administrator must inspect and adopt this corpus.");
  for (const field of ["corpus_id", "tenant_id", "authority_id"] as const) {
    if (typeof row[field] !== "string" || !identifier.test(row[field]) || (expected[field] !== undefined && row[field] !== expected[field])) throw new CorpusBindingError(503, "Persisted corpus ownership does not match the deployment identity.");
  }
  return row;
}

export async function authorizeCorpus(client: TypedQueryClient, principal: ApiKeyPrincipal, expected: CorpusExpectation = {}): Promise<CorpusBinding> {
  const binding = await readCorpusBinding(client, expected);
  if (!principal.tid || principal.tid !== binding.tenant_id) throw new CorpusBindingError(403, "The authenticated tenant does not own this corpus.");
  return binding;
}

/** Metadata-only operator preflight. The database computes hashes; receipt bodies never leave it. */
export async function inspectCorpus(client: TypedQueryClient) {
  const identity = await client.one<{corpus_id:string}>("SELECT corpus_id FROM project_channel_registration_identity WHERE singleton=TRUE");
  const receipts = await client.one<{count:string;digest:string;invalid_count:string}>(`SELECT COUNT(*)::text AS count,
    encode(sha256(convert_to(COALESCE(string_agg(receipt_id || ':' || conversations_registration_receipt_digest(r), E'\\n' ORDER BY receipt_id),''),'UTF8')),'hex') AS digest,
    COUNT(*) FILTER (WHERE tenant_id <> 'default' OR authority_id <> 'conversations' OR corpus_id <> $1)::text AS invalid_count
    FROM project_channel_registration_receipts r`, [identity.corpus_id]);
  return { corpus_id: identity.corpus_id, legacy_receipt_count: Number(receipts.count), legacy_receipt_digest: receipts.digest, unmapped_identity_count: Number(receipts.invalid_count) };
}

export interface CorpusAdoptionInput {
  corpus_id: string; tenant_id: string; authority_id: string; actor: string;
  legacy_receipt_count: number; legacy_receipt_digest: string;
}
export async function adoptCorpus(client: PoolQueryClient, input: CorpusAdoptionInput): Promise<CorpusBinding> {
  if (![input.corpus_id,input.tenant_id,input.authority_id,input.actor].every(value => typeof value === "string" && identifier.test(value)) || !Number.isSafeInteger(input.legacy_receipt_count) || input.legacy_receipt_count < 0 || !/^[a-f0-9]{64}$/.test(input.legacy_receipt_digest)) throw new CorpusBindingError(400, "Invalid corpus adoption identifiers or inventory proof.");
  return client.transaction(async tx => {
    const owner = await tx.one<{allowed:boolean}>("SELECT relowner=current_user::regrole AS allowed FROM pg_class WHERE oid='conversations_corpus_binding'::regclass");
    if (!owner.allowed) throw new CorpusBindingError(403, "Corpus adoption requires the binding table owner role.");
    await tx.execute("LOCK TABLE project_channel_registration_identity, project_channel_registration_receipts, conversations_corpus_binding, conversations_corpus_legacy_receipts IN EXCLUSIVE MODE");
    const existing = await tx.get<CorpusBinding>("SELECT * FROM conversations_corpus_binding WHERE singleton=TRUE");
    if (existing) {
      if (existing.corpus_id !== input.corpus_id || existing.tenant_id !== input.tenant_id || existing.authority_id !== input.authority_id || existing.actor !== input.actor || Number(existing.legacy_receipt_count) !== input.legacy_receipt_count || existing.legacy_receipt_digest !== input.legacy_receipt_digest) throw new CorpusBindingError(409, "Corpus ownership is already bound; adoption cannot reassign it.");
      return existing;
    }
    const inspected = await inspectCorpus(tx);
    if (inspected.corpus_id !== input.corpus_id || inspected.legacy_receipt_count !== input.legacy_receipt_count || inspected.legacy_receipt_digest !== input.legacy_receipt_digest || inspected.unmapped_identity_count !== 0) throw new CorpusBindingError(409, "Corpus inventory changed or contains unrecognized legacy ownership. Inspect it again before adoption.");
    const receipt = await tx.one<CorpusBinding>(`INSERT INTO conversations_corpus_binding(corpus_id,tenant_id,authority_id,receipt_id,actor,legacy_receipt_count,legacy_receipt_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [input.corpus_id,input.tenant_id,input.authority_id,randomUUID(),input.actor,input.legacy_receipt_count,input.legacy_receipt_digest]);
    await tx.execute(`INSERT INTO conversations_corpus_legacy_receipts(receipt_id,adoption_receipt_id,receipt_digest)
      SELECT receipt_id,$1,conversations_registration_receipt_digest(r) FROM project_channel_registration_receipts r`, [receipt.receipt_id]);
    return receipt;
  });
}
