import { getDatabase, now } from "../db/database.js";
import type { ContactsDatabase } from "../db/database.js";

// Simple TF-IDF based similarity (no external API required)
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
}

function buildTfIdf(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const max = Math.max(...freq.values(), 1);
  const result = new Map<string, number>();
  freq.forEach((v, k) => result.set(k, v / max));
  return result;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  a.forEach((v, k) => { if (b.has(k)) dot += v * b.get(k)!; normA += v * v; });
  b.forEach(v => normB += v * v);
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

export function buildContactEmbeddingText(contact: Record<string, unknown>): string {
  const tags = (contact.tags as Array<{ name: string }> | undefined) ?? [];
  const socialProfiles = (contact.social_profiles as Array<{ platform: string }> | undefined) ?? [];
  const company = contact.company as { name?: string; industry?: string } | undefined;
  const parts = [
    contact.display_name as string | undefined,
    contact.job_title as string | undefined,
    contact.notes as string | undefined,
    company?.name,
    company?.industry,
    ...tags.map(t => t.name),
    ...socialProfiles.map(s => s.platform),
  ].filter(Boolean) as string[];
  return parts.join(' ');
}

export async function embedContact(contactId: string, db?: ContactsDatabase): Promise<void> {
  const { getContact } = await import('../db/contacts.js');
  const _db = db || getDatabase();
  const contact = getContact(contactId, _db);
  const text = buildContactEmbeddingText(contact as unknown as Record<string, unknown>);
  const tokens = tokenize(text);
  // Store as sorted token:weight pairs (compact representation)
  const tfidf = buildTfIdf(tokens);
  const embedding = JSON.stringify(Array.from(tfidf.entries()).sort((a, b) => b[1] - a[1]).slice(0, 100));
  _db.query(`INSERT OR REPLACE INTO contact_embeddings(contact_id, embedding, model, embedded_text, created_at, updated_at) VALUES(?,?,'tfidf',?,?,?)`)
    .run(contactId, embedding, text.slice(0, 500), now(), now());
}

export async function embedAllContacts(db?: ContactsDatabase): Promise<number> {
  const _db = db || getDatabase();
  const contacts = _db.query(`SELECT id FROM contacts WHERE archived=0`).all() as { id: string }[];
  for (const c of contacts) {
    try { await embedContact(c.id, _db); } catch { /* skip */ }
  }
  return contacts.length;
}

export function semanticSearch(query: string, limit = 10, db?: ContactsDatabase): Array<{ contact_id: string; score: number }> {
  const _db = db || getDatabase();
  const queryTokens = buildTfIdf(tokenize(query));
  let embeddings: Array<{ contact_id: string; embedding: string }> = [];
  try {
    embeddings = _db.query(`SELECT contact_id, embedding FROM contact_embeddings`).all() as typeof embeddings;
  } catch {
    return [];
  }
  const results = embeddings.map(e => {
    try {
      const emb = new Map<string, number>(JSON.parse(e.embedding) as [string, number][]);
      return { contact_id: e.contact_id, score: cosineSimilarity(queryTokens, emb) };
    } catch { return { contact_id: e.contact_id, score: 0 }; }
  }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return results;
}
