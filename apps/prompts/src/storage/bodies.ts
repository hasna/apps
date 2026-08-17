/**
 * @hasna/prompts — prompt body objects.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Object-first write discipline and verified reads for prompt bodies.
 *
 * Layout: `prompts/<prompt-id>/versions/<version>.md`. Objects are immutable
 * per version; the database records body_uri/body_sha256/body_bytes on the
 * prompt row and on the version row, plus one row in the prompt_bodies
 * registry. The inline body column is retained as rollback data until the
 * verified cutover.
 */
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { getDatabase, getDbPath } from "../db/database.js"
import {
  type BodyStore,
  resolveBodyStore,
  promptBodyKey,
  sha256Hex,
  bytesOf,
  readBodyVerified,
  PromptBodyMissingError,
} from "../body-store.js"

export interface BodyWriteRecord {
  uri: string
  sha256: string
  bytes: number
  mediaType: string
}

/** Default local body root: sibling of the SQLite database; temp for :memory:. */
export function defaultLocalBodyRoot(): string {
  const dbPath = getDbPath({ migrateLegacy: false })
  if (dbPath && dbPath !== ":memory:") {
    return join(dirname(dbPath), "bodies")
  }
  return join(tmpdir(), `hasna-prompts-bodies-${process.pid}`)
}

let _bodyStore: { store: BodyStore; root: string; source: string } | null = null

/** Process-wide body store resolved from environment on first use. */
export function getResolvedBodyStore(env: NodeJS.ProcessEnv = process.env): { store: BodyStore; root: string; source: string } {
  if (!_bodyStore) _bodyStore = resolveBodyStore(env, defaultLocalBodyRoot())
  return _bodyStore
}

/** Process-wide body store (the store half only). */
export function getBodyStore(): BodyStore {
  return getResolvedBodyStore().store
}

/** Reset the cached store (tests, env changes). */
export function resetBodyStore(): void {
  _bodyStore = null
}

/**
 * Write one immutable body object (object-first), returning the record the
 * database transaction then stores. Idempotent: an existing object whose
 * content matches is accepted without a second write; an existing object with
 * different content for the same version key is a conflict, never overwritten.
 */
export async function writePromptBodyObject(
  store: BodyStore,
  promptId: string,
  version: number,
  body: string,
): Promise<BodyWriteRecord> {
  const key = promptBodyKey(promptId, version)
  const sha256 = sha256Hex(body)
  const bytes = bytesOf(body)
  if (await store.exists(key)) {
    const existing = await store.getText(key)
    if (sha256Hex(existing) !== sha256) {
      throw new Error(
        `body object ${key} already exists with different content ` +
          `(sha256 ${sha256Hex(existing)} vs ${sha256}); refusing to overwrite an immutable object`,
      )
    }
    return { uri: store.uriFor(key), sha256, bytes, mediaType: "text/markdown" }
  }
  await store.put({ key, body, content_type: "text/markdown; charset=utf-8" })
  return { uri: store.uriFor(key), sha256, bytes, mediaType: "text/markdown" }
}

/** Register a body object in the prompt_bodies registry (idempotent). */
export function registerBodyObject(
  uri: string,
  sha256: string,
  bytes: number,
  mediaType: string | null,
): void {
  const db = getDatabase()
  db.run(
    `INSERT OR IGNORE INTO prompt_bodies (body_uri, body_sha256, body_bytes, body_media_type)
     VALUES (?, ?, ?, ?)`,
    [uri, sha256, bytes, mediaType ?? "text/markdown"],
  )
}

/** Record a storage event (dual-read fallback, migration writes, drift). */
export function recordStorageEvent(
  kind: string,
  promptId: string,
  version: number,
  detail: string,
): void {
  const db = getDatabase()
  db.run(
    `INSERT INTO prompt_storage_events (id, event_kind, prompt_id, version, detail)
     VALUES (?, ?, ?, ?, ?)`,
    [`pse-${randomUUID()}`, kind, promptId, version, detail],
  )
}

export interface VerifiedReadResult {
  body: string
  sha256: string
  bytes: number
  source: "object" | "inline"
}

/**
 * Verified body read: object first, inline body as a recorded compatibility
 * fallback. A missing object falls back to inline and records the event; a
 * corrupt object falls back to inline only when inline is present, otherwise a
 * named failure. An empty body is never returned where a body is expected.
 */
export async function readPromptBodyVerified(
  store: BodyStore,
  promptId: string,
  version: number,
  expectedSha256: string | null,
  expectedBytes: number | null,
  inlineBody: string,
): Promise<VerifiedReadResult> {
  const key = promptBodyKey(promptId, version)
  if (expectedSha256 === null && expectedBytes === null) {
    return { body: inlineBody, sha256: sha256Hex(inlineBody), bytes: bytesOf(inlineBody), source: "inline" }
  }
  try {
    const verified = await readBodyVerified(store, key, expectedSha256, expectedBytes)
    return { ...verified, source: "object" }
  } catch (error) {
    if (error instanceof PromptBodyMissingError) {
      if (inlineBody.length > 0) {
        recordStorageEvent("inline_fallback", promptId, version, `body object missing; inline body used`)
        return { body: inlineBody, sha256: sha256Hex(inlineBody), bytes: bytesOf(inlineBody), source: "inline" }
      }
      throw error
    }
    if (inlineBody.length > 0) {
      recordStorageEvent(
        "inline_fallback",
        promptId,
        version,
        `body object failed verification (${error instanceof Error ? error.message : String(error)}); inline body used`,
      )
      return { body: inlineBody, sha256: sha256Hex(inlineBody), bytes: bytesOf(inlineBody), source: "inline" }
    }
    throw error
  }
}
