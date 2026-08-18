---
"@hasna/skills": patch
---

Hosted registry gains revision identity and an optimistic-concurrency contract (T8): skills_registry rows carry revision_id (sha over the exact published content) plus revision_number/updated_at via migration 0005; publish/update require the base revision or an If-Match guard, and a stale or missing guard is refused with 409 (SkillRevisionConflictError) instead of silently overwriting; GET returns the revision id; deletes tombstone the row (410 with the marker for the configured window, then purge); pull writes a per-skill marker carrying the installed revision id and proves the revision against the installed bytes (bundle-less pulls install the fetched document verbatim — no trailing-newline normalization — so the recorded revision identifies exactly what is installed); a purged slug is reported, never swapped for the bundled skill. Two-backend parity tests cover 409 races, tombstone lifecycle, purge, revive, and the recompute property on both stores.
