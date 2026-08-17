/**
 * Dispatch domain types for @hasna/prompts.
 *
 * The dispatch engine hands a strictly rendered prompt to an external runtime
 * (initial release: "emit" and "codewith" only) and records a run receipt in
 * the dispatch_runs table. Every receipt binds prompt id, prompt version,
 * resolved references, target, and render hash.
 */

export type DispatchRuntime = "emit" | "codewith"

export type DispatchStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled"

export interface DispatchRun {
  id: string
  runtime: DispatchRuntime
  /** Safe target name (profile name). Never a credential or raw auth payload. */
  target: string | null
  status: DispatchStatus
  prompt_id: string
  prompt_slug: string
  prompt_version: number
  render_hash: string
  vars_hash: string | null
  /** Resolved cross-app references (stable full IDs). Empty in the initial dispatch release. */
  resolved_references: string[]
  /** Pointer to the bounded, redacted capture file (or null for emit runs). */
  output_pointer: string | null
  output_hash: string | null
  output_bytes: number
  exit_code: number | null
  error_code: string | null
  notes: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface DispatchTarget {
  /** Safe profile name passed to --auth-profile (profileName, falling back to displayName). */
  name: string
  /** Named auth profile from the usage payload; null for the default/root entry. */
  profile_name: string | null
  display_name: string
  provider: string | null
  plan: string | null
  ok: boolean
  health_status: string | null
  health_reason: string | null
  /** True only when the provider reports the profile healthy now. */
  available: boolean
  /**
   * Opaque, non-secret provider-account fingerprint (redactedAccountId).
   * Two profiles with the same fingerprint are ONE account and must never be
   * reserved twice. Run records never carry this value.
   */
  fingerprint: string | null
}

export interface DispatchReceipt {
  run: DispatchRun
  /** Emit runtime only: the strictly rendered prompt. Never persisted. */
  rendered?: string
  /** Selected target summary for codewith runs (safe fields only, no fingerprint). */
  target?: {
    name: string
    provider: string | null
    plan: string | null
    health_status: string | null
  }
}

export class DispatchError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "DispatchError"
    this.code = code
  }
}
