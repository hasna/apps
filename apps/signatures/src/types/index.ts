export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  created_at: string;
  updated_at: string;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  created_at: string;
}

export type WorkflowStatus = "draft" | "prepared" | "sent" | "viewed" | "pending" | "signed" | "completed" | "declined" | "expired" | "failed" | "cancelled";
export type DocumentStatus = WorkflowStatus;

export interface Document {
  id: string;
  name: string;
  slug: string;
  description?: string;
  file_path: string;
  file_name: string;
  file_size?: number;
  mime_type: string;
  status: DocumentStatus;
  project_id?: string;
  collection_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type SignatureType = "text" | "image" | "drawing";

export interface Signature {
  id: string;
  name: string;
  type: SignatureType;
  font_family?: string;
  font_size: number;
  color: string;
  text_value?: string;
  image_path?: string;
  image_prompt?: string;
  width?: number;
  height?: number;
  created_at: string;
  updated_at: string;
}

export type FieldType = "signature" | "initial" | "date" | "text" | "checkbox" | "approval";

export interface SignatureField {
  id: string;
  document_id: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  unit?: "percent" | "pdf_points";
  anchor?: string;
  field_type: FieldType;
  label?: string;
  required: number;
  detected: number;
  assigned_to?: string;
  signer_type?: SignerType;
  role?: string;
  signing_order?: number;
  parallel_group?: number;
  recipient_status?: RecipientStatus;
  created_at: string;
}

export interface SignaturePlacement {
  id: string;
  document_id: string;
  signature_id: string;
  field_id?: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  signed_at?: string;
  created_at: string;
}

export type SessionStatus = "draft" | "prepared" | "pending" | "available" | "sent" | "viewed" | "signed" | "completed" | "declined" | "expired" | "failed" | "skipped" | "cancelled";
export type SessionSource = "local" | "connector" | "browseruse" | "email" | "provider";
export type SignerType = "human" | "agent";
export type RecipientStatus = "pending" | "available" | "viewed" | "signed" | "declined" | "expired" | "failed" | "skipped";
export interface AgentAttestation {
  agent_id?: string;
  agent_name?: string;
  agent_provider?: string;
  run_id?: string;
  thread_id?: string;
  policy_id?: string;
  approval_reason?: string;
  input_hash?: string;
  output_hash?: string;
}
export type SignatureLevel = "ses" | "aes" | "qes" | "eseal" | "qeseal";
export type EvidenceStatus = "prepared" | "sent" | "completed" | "failed" | "validated";
export type ValidationStatus = "not_applicable" | "pending" | "valid" | "invalid" | "unknown";

export interface Person {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  signer_type: SignerType;
  agent_id?: string;
  agent_provider?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SigningSession {
  id: string;
  document_id: string;
  person_id?: string;
  signer_name?: string;
  signer_email?: string;
  signer_type: SignerType;
  agent_id?: string;
  agent_provider?: string;
  agent_run_id?: string;
  agent_thread_id?: string;
  agent_policy_id?: string;
  agent_reason?: string;
  agent_input_hash?: string;
  agent_output_hash?: string;
  field_id?: string;
  role?: string;
  signing_order: number;
  parallel_group: number;
  recipient_status: RecipientStatus;
  status: SessionStatus;
  token: string;
  source: SessionSource;
  connector_name?: string;
  metadata?: Record<string, unknown>;
  signing_url?: string;
  attachment_id?: string;
  share_link?: string;
  share_expires_at?: string;
  signed_document_path?: string;
  certificate_path?: string;
  completed_at?: string;
  signature_level?: SignatureLevel;
  assurance_level?: string;
  provider_status?: EvidenceStatus;
  validation_status?: ValidationStatus;
  created_at: string;
  updated_at: string;
}

export type AuditEventType =
  | "document_created"
  | "document_rendered"
  | "session_created"
  | "session_viewed"
  | "session_declined"
  | "email_prepared"
  | "email_sent"
  | "provider_created"
  | "provider_sent"
  | "provider_evidence_created"
  | "provider_evidence_updated"
  | "validation_recorded"
  | "signed"
  | "certificate_created"
  | "domain_configured";

export interface AuditEvent {
  id: string;
  document_id?: string;
  session_id?: string;
  event_type: AuditEventType;
  message?: string;
  actor_name?: string;
  actor_email?: string;
  actor_signer_type?: SignerType;
  actor_agent_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface SigningCertificate {
  id: string;
  document_id: string;
  session_id: string;
  certificate_path: string;
  original_document_hash?: string;
  signed_document_hash?: string;
  verification_code: string;
  metadata?: Record<string, unknown>;
  issued_at: string;
}

export interface ProviderEvidence {
  id: string;
  document_id: string;
  session_id?: string;
  provider: string;
  connector_slug?: string;
  operation?: string;
  signature_level: SignatureLevel;
  signer_type?: SignerType;
  recipient_role?: string;
  status: EvidenceStatus;
  validation_status: ValidationStatus;
  remote_document_id?: string;
  remote_status?: string;
  request?: Record<string, unknown>;
  response?: unknown;
  evidence?: Record<string, unknown>;
  original_document_hash?: string;
  signed_document_hash?: string;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  total_documents: number;
  by_status: Record<string, number>;
  total_signatures: number;
  total_projects: number;
  total_collections: number;
  total_tags: number;
  total_placements: number;
  total_sessions: number;
  total_people?: number;
  total_agents?: number;
}

// Error types
export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class DuplicateError extends Error {
  constructor(resource: string, field: string, value: string) {
    super(`${resource} with ${field} '${value}' already exists`);
    this.name = "DuplicateError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
