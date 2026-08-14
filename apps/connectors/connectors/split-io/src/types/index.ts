// Split.io Connector Types

export interface SplitIoConfig {
  apiKey: string;
}

export type OutputFormat = 'json' | 'pretty';

export type ChangeRequestStatus =
  | 'REQUESTED'
  | 'SCHEDULE_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'PUBLISHED';

export type UserStatus = 'ACTIVE' | 'DEACTIVATED' | 'PENDING';

export interface SplitOwner {
  id: string;
  type: string;
}

export interface SplitTreatment {
  name: string;
  description?: string;
  configurations?: string;
  keys?: string[];
  segments?: string[];
}

export interface SplitDefinition {
  treatments?: SplitTreatment[];
  defaultTreatment?: string;
  rules?: Array<Record<string, unknown>>;
  defaultRule?: Array<{ treatment: string; size: number }>;
  baselineTreatment?: string;
  trafficAllocation?: number;
  comment?: string;
  [key: string]: unknown;
}

export class SplitIoApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'SplitIoApiError';
    this.status = status;
    this.details = details;
  }
}
