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

export type DocumentStatus = "draft" | "pending" | "completed" | "cancelled";

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

export type FieldType = "signature" | "initial" | "date" | "text" | "checkbox";

export interface SignatureField {
  id: string;
  document_id: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  field_type: FieldType;
  label?: string;
  required: number;
  detected: number;
  assigned_to?: string;
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

export type SessionStatus = "pending" | "completed" | "expired";
export type SessionSource = "local" | "connector" | "browseruse";

export interface SigningSession {
  id: string;
  document_id: string;
  signer_name?: string;
  signer_email?: string;
  status: SessionStatus;
  token: string;
  source: SessionSource;
  connector_name?: string;
  metadata?: Record<string, unknown>;
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
