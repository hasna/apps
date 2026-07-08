/**
 * @hasna/logs — canonical table inventory.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * A plain list of the app-owned SQLite tables. Used by maintenance/redaction
 * tooling to enumerate storage surfaces. Contains NO connection code and NO
 * DSN handling — the raw RDS DSN is never distributed to clients (CLAUDE.md §2).
 */
export const STORAGE_TABLES = [
  "projects",
  "pages",
  "logs",
  "event_segments",
  "event_records",
  "machines",
  "repositories",
  "apps",
  "processes",
  "runs",
  "event_sources",
  "traces",
  "spans",
  "sessions",
  "releases",
  "artifacts",
  "source_maps",
  "source_map_sources",
  "test_reports",
  "test_cases",
  "projection_offsets",
  "sync_cursors",
  "scan_jobs",
  "scan_runs",
  "performance_snapshots",
  "alert_rules",
  "issues",
  "feedback",
] as const;

export const LOGS_STORAGE_TABLES = STORAGE_TABLES;
