// SQL helpers shared by the PostgreSQL service and isolated dialect fixtures.
export function nowIso() {
  return new Date().toISOString();
}

/** Per-tenant monotonic sequence (S2 dialect superset, gate doc GAP-5). */
export async function nextSeq(db, tenantId) {
  // The conflict-update target differs: SQLite lets a bare `value` name the
  // existing row; PostgreSQL rejects the ambiguous reference and needs the
  // table-qualified form (which SQLite also accepts).
  const increment = db.backend === 'postgresql' ? 'seq_counters.value + 1' : 'value + 1';
  const row = await db
    .query(
      `INSERT INTO seq_counters (tenant_id, value) VALUES (?, 1)
       ON CONFLICT (tenant_id) DO UPDATE SET value = ${increment}
       RETURNING value`,
    )
    .get(tenantId);
  return row.value;
}

export async function currentSeq(db, tenantId) {
  const row = await db.query('SELECT value FROM seq_counters WHERE tenant_id = ?').get(tenantId);
  return row ? row.value : 0;
}

export async function getMeta(db, key) {
  const row = await db.query('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export async function setMeta(db, key, value) {
  await db.query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
