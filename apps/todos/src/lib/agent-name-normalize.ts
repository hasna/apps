/**
 * Canonical agent-name normalisation, shared by every storage engine.
 *
 * Agent names are a case-INSENSITIVE identity: `fabricius`, `Fabricius` and
 * `FABRICIUS` are one agent, not three. This module is the single source of
 * truth for that rule.
 *
 * It lives in `lib/` and imports NOTHING on purpose. The rule is needed by both
 * the SQLite engine (`db/agent-names.ts`) and the Postgres engine
 * (`storage/postgres-adapter.ts`), and the Postgres adapter must not reach into
 * `db/`, whose module graph loads `bun:sqlite` at import time. Duplicating the
 * two lines instead is what let the engines drift apart in the first place
 * (todos task 0bf5d979): SQLite normalised, Postgres compared with `===`, and
 * one agent silently became two roster rows with divergent last_seen_at.
 */
export function normalizeAgentNameInput(name: string): string {
  return name.trim().toLowerCase();
}
