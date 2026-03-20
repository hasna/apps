import type { Database } from "bun:sqlite";

// Find contacts sharing the same email address
export function findEmailDuplicates(db: Database): Array<{ email: string; contact_ids: string[] }> {
  const rows = db.query(`
    SELECT e.address as email, GROUP_CONCAT(e.contact_id) as ids
    FROM emails e
    WHERE e.contact_id IS NOT NULL
    GROUP BY LOWER(e.address)
    HAVING COUNT(*) > 1
  `).all() as { email: string; ids: string }[];
  return rows.map(r => ({ email: r.email, contact_ids: r.ids.split(',') }));
}

// Simple Levenshtein for name similarity
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] = a[i-1] === b[j-1] ? dp[i-1]![j-1]! :
        1 + Math.min(dp[i-1]![j]!, dp[i]![j-1]!, dp[i-1]![j-1]!);
  return dp[m]![n]!;
}

export function findNameDuplicates(db: Database): Array<{ contact_ids: [string, string]; similarity: number }> {
  const contacts = db.query(`SELECT id, display_name FROM contacts`).all() as { id: string; display_name: string }[];
  const pairs: Array<{ contact_ids: [string, string]; similarity: number }> = [];
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const dist = levenshtein(contacts[i]!.display_name.toLowerCase(), contacts[j]!.display_name.toLowerCase());
      if (dist <= 2 && dist > 0) {
        pairs.push({ contact_ids: [contacts[i]!.id, contacts[j]!.id], similarity: dist });
      }
    }
  }
  return pairs;
}
