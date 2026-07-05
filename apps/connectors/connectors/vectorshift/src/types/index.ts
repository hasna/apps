// VectorShift Connector Types

export interface VectorShiftConfig {
  apiKey: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

export type DataType =
  | string
  | number
  | boolean
  | null
  | DataType[]
  | Record<string, unknown>;

export interface ListResponse {
  status: 'success' | 'failed';
  object_ids: string[];
  objects?: Record<string, unknown>[];
}

export interface ListPipelinesOptions {
  includeShared?: boolean;
  verbose?: boolean;
}

export interface RunPipelineRequest {
  inputs?: Record<string, DataType>;
}

export interface RunPipelineResponse {
  status: 'success' | 'failed';
  run_id: string;
  outputs: Record<string, DataType>;
}

export interface ListChatbotsOptions {
  includeShared?: boolean;
  verbose?: boolean;
}

export interface RunChatbotRequest {
  text?: string;
  audio?: string;
  conversation_id?: string;
  stream?: boolean;
}

export interface RunChatbotResponse {
  status: 'success' | 'failed';
  conversation_id: string;
  output_message: string;
  follow_up_questions?: string[];
}

export interface PipelineVersionRef {
  id: string;
  version?: 'latest' | { major: number; minor: number; patch: number };
}

export interface CreateChatbotRequest {
  pipeline: PipelineVersionRef;
  name: string;
  description: string;
  deployment_options?: Record<string, unknown>;
  access_config?: Record<string, unknown>;
  twilio_config?: Record<string, unknown>;
  slack_config?: Record<string, unknown>;
  deployed?: boolean;
  input: string;
  output: string;
}

export interface CreateChatbotResponse {
  status: 'success' | 'failed';
  id: string;
}

export class VectorShiftApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'VectorShiftApiError';
    this.statusCode = statusCode;
  }
}
