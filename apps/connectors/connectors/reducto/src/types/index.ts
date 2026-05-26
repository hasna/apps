// Reducto API Types

export type OutputFormat = 'json' | 'pretty';

// Configuration
export interface ProfileConfig {
  apiKey?: string;
}

export interface ReductoConfig {
  currentProfile: string;
  profiles: Record<string, ProfileConfig>;
}

// Common types
export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BoundingBoxOrigin {
  left: number;
  top: number;
  right: number;
  bottom: number;
  page: number;
}

// Parse API types
export type ChunkingStrategy = 'page' | 'section' | 'paragraph' | 'none';
export type OutputMode = 'text' | 'markdown' | 'html';

export interface ParseOptions {
  chunkingStrategy?: ChunkingStrategy;
  outputMode?: OutputMode;
  extractTables?: boolean;
  extractImages?: boolean;
  ocrLanguages?: string[];
  pageRange?: string;
  webhook?: string;
  priority?: 'standard' | 'high';
}

export interface TableCell {
  content: string;
  rowSpan?: number;
  colSpan?: number;
  bbox?: BoundingBox;
}

export interface Table {
  headers: string[];
  rows: TableCell[][];
  bbox?: BoundingBoxOrigin;
  confidence?: number;
}

export interface Image {
  url: string;
  caption?: string;
  bbox?: BoundingBoxOrigin;
}

export interface Chunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  bbox?: BoundingBoxOrigin;
  metadata?: Record<string, unknown>;
}

export interface ParseResult {
  jobId: string;
  status: 'completed' | 'processing' | 'failed';
  documentId?: string;
  chunks?: Chunk[];
  tables?: Table[];
  images?: Image[];
  pageCount?: number;
  processingTime?: number;
  error?: string;
}

// Extract API types
export interface FieldDefinition {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date';
  required?: boolean;
  arrayOf?: FieldDefinition;
  properties?: FieldDefinition[];
}

export interface Schema {
  fields: FieldDefinition[];
}

export interface ExtractOptions {
  schema: Schema;
  examples?: Record<string, unknown>[];
  webhook?: string;
  priority?: 'standard' | 'high';
}

export interface ExtractResult {
  jobId: string;
  status: 'completed' | 'processing' | 'failed';
  documentId?: string;
  data?: Record<string, unknown>;
  confidence?: Record<string, number>;
  processingTime?: number;
  error?: string;
}

// Split API types
export interface SplitOptions {
  splitBy?: 'page' | 'section' | 'custom';
  customDelimiter?: string;
  maxChunkSize?: number;
  overlap?: number;
  webhook?: string;
}

export interface SplitSegment {
  content: string;
  startPage: number;
  endPage: number;
  segmentIndex: number;
  metadata?: Record<string, unknown>;
}

export interface SplitResult {
  jobId: string;
  status: 'completed' | 'processing' | 'failed';
  documentId?: string;
  segments?: SplitSegment[];
  segmentCount?: number;
  processingTime?: number;
  error?: string;
}

// Edit API types
export type EditOperation = 'fill' | 'replace' | 'redact' | 'insert';

export interface FieldEdit {
  fieldName: string;
  value: string | number | boolean;
  operation?: EditOperation;
}

export interface EditOptions {
  edits: FieldEdit[];
  outputFormat?: 'pdf' | 'docx';
  flatten?: boolean;
  webhook?: string;
}

export interface EditResult {
  jobId: string;
  status: 'completed' | 'processing' | 'failed';
  documentId?: string;
  outputUrl?: string;
  processingTime?: number;
  error?: string;
}

// Job status
export interface JobStatus {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: ParseResult | ExtractResult | SplitResult | EditResult;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

// Document types
export interface Document {
  documentId: string;
  filename: string;
  mimeType: string;
  size: number;
  pageCount?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// Error types
export interface ReductoError extends Error {
  name: 'ReductoError';
  message: string;
  statusCode?: number;
  details?: unknown;
}

export class AuthenticationError extends Error {
  constructor(message: string = 'Not authenticated. Run "connect-reducto auth setup" first.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}
