import { createPgPool } from "../generated/storage-kit/pool.js";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { adoptCorpus, inspectCorpus, CorpusBindingError } from "./corpus-binding.js";

export async function runCorpusAdmin(args: string[]): Promise<void> {
  const action = args.shift();
  if (action !== "inspect" && action !== "adopt") throw new CorpusBindingError(400, "Use corpus inspect or corpus adopt.");
  const allowed = new Set(["corpus-id","tenant-id","authority-id","actor","legacy-receipt-count","legacy-receipt-digest"]);
  const parsed = new Map<string,string>();
  while (args.length) {
    const flag = args.shift()!;
    const name = flag.startsWith("--") ? flag.slice(2) : "";
    const value = args.shift();
    if (!allowed.has(name) || parsed.has(name) || value === undefined || value.startsWith("--")) throw new CorpusBindingError(400, "Invalid or duplicate corpus adoption option.");
    parsed.set(name,value);
  }
  if (action === "inspect" && parsed.size) throw new CorpusBindingError(400, "corpus inspect takes no adoption options.");
  if (action === "adopt" && parsed.size !== allowed.size) throw new CorpusBindingError(400, "Corpus adoption requires corpus, tenant, authority, actor and exact legacy receipt count/digest.");
  const dsn = process.env.HASNA_CONVERSATIONS_DATABASE_URL_OWNER;
  if (!dsn) throw new CorpusBindingError(503, "Corpus administration requires the explicit HASNA_CONVERSATIONS_DATABASE_URL_OWNER connection.");
  const pool = createPgPool({connectionString:dsn,applicationName:"conversations-corpus-admin",max:1});
  try {
    const client = createQueryClient(pool);
    const result = action === "inspect" ? await inspectCorpus(client) : await adoptCorpus(client,{
      corpus_id:parsed.get("corpus-id")!,tenant_id:parsed.get("tenant-id")!,authority_id:parsed.get("authority-id")!,actor:parsed.get("actor")!,
      legacy_receipt_count:/^(0|[1-9][0-9]*)$/.test(parsed.get("legacy-receipt-count")!) ? Number(parsed.get("legacy-receipt-count")) : NaN,
      legacy_receipt_digest:parsed.get("legacy-receipt-digest")!,
    });
    console.log(JSON.stringify(result));
  } finally { await pool.end(); }
}
