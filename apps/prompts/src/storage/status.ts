/**
 * @hasna/prompts — storage status.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * `prompts storage status`: selected client/server stores, body-store
 * readiness, and migration/drift counts. Never renders credentials, bucket
 * capabilities, or connection strings.
 */
import { getDatabase } from "../db/database.js"
import { resolveServerBackend } from "../db/database.js"
import { resolvePromptsClientTransport, PROMPTS_API_URL_ENV, PROMPTS_API_KEY_ENV } from "../client-transport.js"
import { getResolvedBodyStore } from "./bodies.js"
import { promptBodyKey } from "../body-store.js"

export interface StorageStatusReport {
  client: {
    transport: "sqlite" | "http"
    api_url_present: boolean
    api_key_present: boolean
    api_url_env: typeof PROMPTS_API_URL_ENV
    api_key_env: typeof PROMPTS_API_KEY_ENV
  }
  server: {
    backend: "sqlite" | "postgresql"
    database_url_env: "HASNA_PROMPTS_DATABASE_URL"
  }
  body_store: {
    type: "local" | "s3"
    root: string
    source: string
  }
  migration: {
    prompts_total: number
    prompts_with_object: number
    versions_total: number
    versions_with_object: number
    registry_rows: number
    missing_objects: number
    missing_object_ids: string[]
  }
}

export async function storageStatus(env: NodeJS.ProcessEnv = process.env): Promise<StorageStatusReport> {
  const transport = resolvePromptsClientTransport(env)
  const backend = resolveServerBackend(env)
  const resolved = getResolvedBodyStore(env)
  const store = resolved.store

  const db = getDatabase()
  const promptsTotal = (db.query("SELECT COUNT(*) as n FROM prompts").get() as { n: number }).n
  const promptsWithObject = (db.query("SELECT COUNT(*) as n FROM prompts WHERE body_uri IS NOT NULL").get() as { n: number }).n
  const versionsTotal = (db.query("SELECT COUNT(*) as n FROM prompt_versions").get() as { n: number }).n
  const versionsWithObject = (db.query("SELECT COUNT(*) as n FROM prompt_versions WHERE body_uri IS NOT NULL").get() as { n: number }).n
  const registryRows = (db.query("SELECT COUNT(*) as n FROM prompt_bodies").get() as { n: number }).n

  const missing: string[] = []
  const referenced = db
    .query("SELECT id, version, body_uri FROM prompts WHERE body_uri IS NOT NULL")
    .all() as Array<{ id: string; version: number; body_uri: string }>
  for (const row of referenced) {
    const key = promptBodyKey(row.id, row.version)
    try {
      const exists = await store.exists(key)
      if (!exists) missing.push(row.id)
    } catch {
      missing.push(row.id)
    }
  }

  return {
    client: {
      transport: transport.transport,
      api_url_present: transport.api_url_present,
      api_key_present: transport.api_key_present,
      api_url_env: PROMPTS_API_URL_ENV,
      api_key_env: PROMPTS_API_KEY_ENV,
    },
    server: {
      backend,
      database_url_env: "HASNA_PROMPTS_DATABASE_URL",
    },
    body_store: {
      type: store.type,
      root: resolved.root,
      source: resolved.source,
    },
    migration: {
      prompts_total: promptsTotal,
      prompts_with_object: promptsWithObject,
      versions_total: versionsTotal,
      versions_with_object: versionsWithObject,
      registry_rows: registryRows,
      missing_objects: missing.length,
      missing_object_ids: missing,
    },
  }
}
