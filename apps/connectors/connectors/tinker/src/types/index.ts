// Tinker Connector Types

// ============================================
// Configuration
// ============================================

export interface TinkerConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'yaml' | 'pretty';

export type LossFunction = 'cross_entropy' | 'dpo' | 'custom';

// ============================================
// Model Types
// ============================================

export interface ModelInfo {
  name: string;
  displayName?: string;
  contextLength?: number;
  supportsVision?: boolean;
  parameters?: string;
}

export interface ServerCapabilities {
  models: ModelInfo[];
  supportedLossFunctions: LossFunction[];
  maxBatchSize?: number;
}

// ============================================
// Training Types
// ============================================

export interface LoRAConfig {
  baseModel: string;
  rank: number;
  alpha?: number;
  targetModules?: string[];
  dropout?: number;
}

export interface AdamParams {
  learningRate: number;
  beta1?: number;
  beta2?: number;
  epsilon?: number;
  weightDecay?: number;
}

export interface EncodedTextChunk {
  type: 'text';
  tokens: number[];
}

export interface ImageChunk {
  type: 'image';
  data: string; // base64 encoded
  format: 'png' | 'jpeg' | 'webp';
}

export type InputChunk = EncodedTextChunk | ImageChunk;

export interface ModelInput {
  chunks: InputChunk[];
}

export interface LossFnInputs {
  weights: number[];
  targetTokens: number[];
}

export interface Datum {
  modelInput: ModelInput;
  lossFnInputs: LossFnInputs;
}

export interface ForwardBackwardRequest {
  data: Datum[];
  lossFn: LossFunction;
  lossFnConfig?: Record<string, unknown>;
}

export interface ForwardBackwardResponse {
  requestId: string;
  loss: number;
  gradientNorm?: number;
  numTokens: number;
  status: 'success' | 'error';
  error?: string;
}

export interface OptimStepRequest {
  adamParams: AdamParams;
}

export interface OptimStepResponse {
  requestId: string;
  status: 'success' | 'error';
  stepNumber?: number;
  error?: string;
}

// ============================================
// State Management Types
// ============================================

export interface SaveStateRequest {
  name: string;
  ttlSeconds?: number;
  includeOptimizer?: boolean;
}

export interface SaveStateResponse {
  requestId: string;
  path: string;
  status: 'success' | 'error';
  error?: string;
}

export interface LoadStateRequest {
  path: string;
  includeOptimizer?: boolean;
}

export interface LoadStateResponse {
  requestId: string;
  status: 'success' | 'error';
  error?: string;
}

export interface GetCheckpointUrlRequest {
  path: string;
}

export interface GetCheckpointUrlResponse {
  requestId: string;
  url: string;
  expiresAt: string;
}

export interface ListStatesResponse {
  states: SavedState[];
}

export interface SavedState {
  name: string;
  path: string;
  createdAt: string;
  expiresAt?: string;
  sizeBytes?: number;
  hasOptimizer: boolean;
}

// ============================================
// Sampling/Inference Types
// ============================================

export interface SamplingParams {
  maxTokens: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
}

export interface SampleRequest {
  prompt: ModelInput;
  samplingParams: SamplingParams;
  numSamples?: number;
  includePromptLogprobs?: boolean;
  topkPromptLogprobs?: number;
}

export interface TokenLogprob {
  token: string;
  tokenId: number;
  logprob: number;
}

export interface SampleOutput {
  text: string;
  tokens: number[];
  finishReason: 'stop' | 'length' | 'error';
  logprobs?: TokenLogprob[];
}

export interface SampleResponse {
  requestId: string;
  outputs: SampleOutput[];
  promptLogprobs?: TokenLogprob[][];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ComputeLogprobsRequest {
  prompt: ModelInput;
}

export interface ComputeLogprobsResponse {
  requestId: string;
  logprobs: TokenLogprob[];
  totalLogprob: number;
}

// ============================================
// Training Client Types
// ============================================

export interface CreateTrainingClientRequest {
  baseModel: string;
  rank?: number;
  alpha?: number;
  targetModules?: string[];
}

export interface CreateTrainingClientResponse {
  clientId: string;
  baseModel: string;
  loraConfig: LoRAConfig;
  status: 'ready' | 'initializing' | 'error';
}

export interface TrainingClientInfo {
  clientId: string;
  baseModel: string;
  loraConfig: LoRAConfig;
  currentStep: number;
  totalGradientAccumulations: number;
}

// ============================================
// Sampling Client Types
// ============================================

export interface CreateSamplingClientRequest {
  modelPath: string;
}

export interface CreateSamplingClientResponse {
  clientId: string;
  modelPath: string;
  status: 'ready' | 'loading' | 'error';
}

export interface SamplingClientInfo {
  clientId: string;
  modelPath: string;
  baseModel: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class TinkerApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'TinkerApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}
