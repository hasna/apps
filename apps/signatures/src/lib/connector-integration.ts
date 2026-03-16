/**
 * Connector integration for open-signatures.
 *
 * Provides hooks for external connectors (e.g. browseruse) to initiate and
 * record signing sessions.  The module deliberately avoids a hard dependency
 * on any connector SDK at runtime — callers are responsible for driving the
 * actual browser automation and then calling `registerSigningSession` /
 * `completeSigningSession` to persist the result.
 */

import { createSigningSession, updateSessionStatus } from "../db/signing-sessions.js";
import { getDocumentByIdOrSlug, updateDocument } from "../db/documents.js";
import type { SigningSession } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowseruseSignOptions {
  /** Human-readable name of the signer */
  signer_name?: string;
  /** Email address of the signer */
  signer_email?: string;
  /** Extra metadata to persist with the session (e.g. connector job IDs) */
  metadata?: Record<string, unknown>;
}

export interface RegisterSessionOptions {
  document_id: string;
  connector_name: string;
  signer_name?: string;
  signer_email?: string;
  /** URL of the external signing page, stored in metadata */
  signing_url?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initiate a browseruse-driven signing session for a document.
 *
 * The function resolves the document (by ID or slug), creates a
 * `SigningSession` with `source='browseruse'` and `connector_name='browseruse'`,
 * and returns the session so callers can hand the `token` to the browser
 * automation layer.
 *
 * @param documentId  Document ID or slug.
 * @param url         URL of the web-based signing portal to open.
 * @param options     Optional signer details / metadata.
 */
export function signWithBrowseruse(
  documentId: string,
  url: string,
  options: BrowseruseSignOptions = {}
): SigningSession {
  // Validate the document exists
  const doc = getDocumentByIdOrSlug(documentId);

  const session = createSigningSession({
    document_id: doc.id,
    signer_name: options.signer_name,
    signer_email: options.signer_email,
    source: "browseruse",
    connector_name: "browseruse",
    metadata: {
      signing_url: url,
      ...options.metadata,
    },
  });

  return session;
}

/**
 * Register a signing session from any external connector.
 *
 * Call this when an external connector (DocuSign, HelloSign, browseruse, etc.)
 * starts a signing workflow.  The session is persisted with
 * `source='connector'` and the supplied `connector_name`.
 */
export function registerSigningSession(
  options: RegisterSessionOptions
): SigningSession {
  // Validate the document exists
  const doc = getDocumentByIdOrSlug(options.document_id);

  const session = createSigningSession({
    document_id: doc.id,
    signer_name: options.signer_name,
    signer_email: options.signer_email,
    source: "connector",
    connector_name: options.connector_name,
    metadata: {
      ...(options.signing_url ? { signing_url: options.signing_url } : {}),
      ...options.metadata,
    },
  });

  return session;
}

/**
 * Mark a connector signing session as completed and optionally update the
 * document status to "completed".
 */
export function completeSigningSession(
  sessionId: string,
  markDocumentCompleted = true
): SigningSession {
  const session = updateSessionStatus(sessionId, "completed");

  if (markDocumentCompleted) {
    try {
      updateDocument(session.document_id, { status: "completed" });
    } catch {
      // Document update failure should not prevent session completion
    }
  }

  return session;
}
