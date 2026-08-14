// Strand AI Platform API types (https://app.strandai.com/api/v1/openapi.json)

export interface StrandConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface StrandError {
  error: string;
  message: string;
  required?: number | null;
}

export interface UploadCreated {
  uploadId: string;
  uploadUrl: string;
  gcsPath: string;
}

export interface UploadComplete {
  uploadId: string;
  status: 'ready';
  widthPx: number;
  heightPx: number;
  dimensionsSource?: 'sharp' | 'stub';
}

export interface Upload {
  id: string;
  filename: string;
  fileSize: string;
  status: string;
  gcsPath: string;
  createdAt?: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
}

export interface UploadList {
  uploads: Upload[];
  nextCursor?: string | null;
}

export interface InitiateUploadRequest {
  filename: string;
  fileSize: number;
  contentType: string;
}

export interface Estimate {
  patchCount: number;
  markerCount: number;
  estimatedCredits: number;
  orgBalance: number;
  orgPending: number;
}

export interface EstimateRequest {
  uploadId: string;
  markers: string[];
}

export interface Submission {
  jobId: string;
  reservedCredits: number;
  status: 'queued';
}

export type LatticeModel = 'v0.4' | 'v0.5' | 'v0.6';

export interface SubmitPredictionRequest {
  uploadId: string;
  markers: string[];
  model?: LatticeModel;
}

export interface Job {
  id: string;
  status: string;
  progress?: number | null;
  reservedCredits?: number | null;
  markers: string[];
  model?: string | null;
  metadata?: {
    modal?: {
      endpoint_url?: string | null;
      model?: string | null;
    };
  } | null;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  resultsAvailable?: boolean;
}

export interface JobCancelResponse {
  id: string;
  status: 'cancelled';
}

export interface Results {
  resultUrl: string;
  resultBasePath?: string;
  expiresAt: string;
}

export interface ExpirationUpdate {
  expiresAt?: string | null;
  neverExpire?: boolean;
  useOrgDefault?: boolean;
  reason?: string;
}

export interface Sample {
  id: string;
  expiresAt?: string | null;
  expiresAtSource?: 'org_default' | 'custom' | null;
  expirationChangedAt?: string | null;
  expirationChangedBy?: string | null;
  batchId?: string;
}

export interface BulkExpirationRequest extends ExpirationUpdate {
  sampleIds: string[];
}

export interface BulkExpirationResponse {
  updated: number;
  batchId: string;
}

export interface SampleRestoreResponse {
  id: string;
  trashedAt: null;
  expiresAt?: string | null;
}

export class StrandApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'StrandApiError';
  }
}
