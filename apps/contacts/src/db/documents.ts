import { getDatabase, uuid, now } from "./database.js";
import { encrypt, decrypt, encryptFile, decryptFile, requireVault, getDocumentsDir } from "../lib/vault.js";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

export const DOCUMENT_TYPES = [
  "passport", "national_id", "tax_id", "ssn", "drivers_license",
  "bank_account", "visa", "insurance", "contract", "certificate",
  "medical_record", "prescription", "allergy_list", "vaccination",
  "blood_type", "health_insurance", "medical_condition",
  "emergency_contact_medical", "other"
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export interface ContactDocument {
  id: string;
  contact_id: string;
  doc_type: DocumentType;
  label: string | null;
  value: string; // decrypted
  has_file: boolean;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactDocumentSummary {
  id: string;
  doc_type: string;
  label: string | null;
  has_file: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface CreateDocumentInput {
  contact_id: string;
  doc_type: DocumentType;
  label?: string;
  value: string; // plaintext — will be encrypted
  file_path?: string; // optional file to encrypt and attach
  metadata?: Record<string, unknown>;
  expires_at?: string;
}

export function addDocument(input: CreateDocumentInput, db?: Database): ContactDocument {
  requireVault(); // must be unlocked
  const _db = db || getDatabase();
  const id = uuid();
  const { ciphertext, iv } = encrypt(input.value);
  let encFilePath: string | null = null;
  if (input.file_path) {
    encFilePath = encryptFile(input.file_path, id);
  }
  _db.query(`INSERT INTO contact_documents (id, contact_id, doc_type, label, encrypted_value, iv, encrypted_file_path, metadata, expires_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, input.contact_id, input.doc_type, input.label ?? null, ciphertext, iv, encFilePath, JSON.stringify(input.metadata || {}), input.expires_at ?? null, now(), now());
  return getDocument(id, _db);
}

export function getDocument(id: string, db?: Database): ContactDocument {
  requireVault();
  const _db = db || getDatabase();
  const row = _db.query(`SELECT * FROM contact_documents WHERE id = ?`).get(id) as Record<string, unknown> | null;
  if (!row) throw new Error(`Document not found: ${id}`);
  return rowToDoc(row);
}

export function listDocuments(contactId: string, db?: Database): ContactDocumentSummary[] {
  // List does NOT require vault — shows metadata only, not values
  const _db = db || getDatabase();
  const rows = _db.query(`SELECT id, doc_type, label, encrypted_file_path, expires_at, created_at FROM contact_documents WHERE contact_id = ? ORDER BY created_at DESC`).all(contactId) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string, doc_type: r.doc_type as string, label: r.label as string | null,
    has_file: !!(r.encrypted_file_path),
    expires_at: r.expires_at as string | null, created_at: r.created_at as string
  }));
}

export function deleteDocument(id: string, db?: Database): void {
  const _db = db || getDatabase();
  const row = _db.query(`SELECT encrypted_file_path FROM contact_documents WHERE id = ?`).get(id) as { encrypted_file_path: string | null } | null;
  if (row?.encrypted_file_path && existsSync(row.encrypted_file_path)) {
    try { unlinkSync(row.encrypted_file_path); } catch { /* best effort */ }
  }
  _db.query(`DELETE FROM contact_documents WHERE id = ?`).run(id);
}

function rowToDoc(row: Record<string, unknown>): ContactDocument {
  return {
    id: row.id as string,
    contact_id: row.contact_id as string,
    doc_type: row.doc_type as DocumentType,
    label: row.label as string | null,
    value: decrypt(row.encrypted_value as string, row.iv as string),
    has_file: !!(row.encrypted_file_path),
    metadata: JSON.parse((row.metadata as string) || "{}"),
    expires_at: row.expires_at as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
