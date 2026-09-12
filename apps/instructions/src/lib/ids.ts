/**
 * Pure id / timestamp / slug helpers.
 *
 * They lived in `../db/database.ts` next to the SQLite handle, which meant any
 * module that wanted `slugify` — `config-target-identity.ts`, reached from the
 * CLI and from every MCP tool — dragged `bun:sqlite` and the whole on-box store
 * into the bundle with it (W12 fail-closed residue, 2026-09-11). They depend on
 * nothing but `node:crypto`, so they belong in a leaf module; `db/database.ts`
 * re-exports them unchanged for the local store and for the package's public
 * surface.
 */
import { randomUUID } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
