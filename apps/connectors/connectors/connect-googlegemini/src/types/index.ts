// Google Gemini API Types

// ============ Models ============
export type GeminiModel =
  // Text Generation Models
  | 'gemini-3-pro-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  // Image Generation Models (Nano Banana)
  | 'gemini-2.5-flash-preview-image-generation'
  | 'gemini-3-pro-image-preview'
  // TTS Models
  | 'gemini-2.5-flash-preview-tts'
  | 'gemini-2.5-pro-preview-tts'
  // Embedding Model
  | 'gemini-embedding-001'
  // Legacy
  | 'gemini-2.0-flash'
  | 'gemini-2.0-flash-lite'
  | string;

export type VeoModel =
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-2.0-generate-001'
  | string;

export interface ModelInfo {
  name: string;
  displayName: string;
  description: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
}

// ============ Content Types ============
export interface Part {
  text?: string;
  inlineData?: InlineData;
  fileData?: FileData;
}

export interface InlineData {
  mimeType: string;
  data: string; // base64 encoded
}

export interface FileData {
  mimeType: string;
  fileUri: string;
}

export interface Content {
  parts: Part[];
  role?: 'user' | 'model';
}

// ============ Generation Config ============
export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: 'text/plain' | 'application/json';
  responseModalities?: ('TEXT' | 'IMAGE' | 'AUDIO')[];
  speechConfig?: SpeechConfig;
  imageConfig?: ImageConfig;
}

export interface ImageConfig {
  aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
  imageSize?: '1K' | '2K' | '4K';
  numberOfImages?: number;
}

export interface SpeechConfig {
  voiceConfig?: VoiceConfig;
  multiSpeakerVoiceConfig?: MultiSpeakerVoiceConfig;
}

export interface VoiceConfig {
  prebuiltVoiceConfig: {
    voiceName: VoiceName;
  };
}

export interface MultiSpeakerVoiceConfig {
  speakerVoiceConfigs: SpeakerVoiceConfig[];
}

export interface SpeakerVoiceConfig {
  speaker: string;
  voiceConfig: VoiceConfig;
}

export type VoiceName =
  | 'Kore'
  | 'Puck'
  | 'Charon'
  | 'Zephyr'
  | 'Fenrir'
  | 'Leda'
  | 'Enceladus'
  | 'Aoede'
  | 'Callirrhoe'
  | 'Autonoe'
  | 'Aitne'
  | 'Elara'
  | 'Iocaste'
  | 'Umbriel'
  | 'Algieba'
  | 'Despina'
  | 'Erinome'
  | 'Algenib'
  | 'Rasalgethi'
  | 'Laomedeia'
  | 'Achernar'
  | 'Alnilam'
  | 'Schedar'
  | 'Gacrux'
  | 'Pulcherrima'
  | 'Achird'
  | 'Zubenelgenubi'
  | 'Vindemiatrix'
  | 'Sadachbia'
  | 'Sadaltager'
  | string;

// ============ Safety Settings ============
export type HarmCategory =
  | 'HARM_CATEGORY_HARASSMENT'
  | 'HARM_CATEGORY_HATE_SPEECH'
  | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
  | 'HARM_CATEGORY_DANGEROUS_CONTENT';

export type HarmBlockThreshold =
  | 'BLOCK_NONE'
  | 'BLOCK_LOW_AND_ABOVE'
  | 'BLOCK_MEDIUM_AND_ABOVE'
  | 'BLOCK_ONLY_HIGH';

export interface SafetySetting {
  category: HarmCategory;
  threshold: HarmBlockThreshold;
}

// ============ Generate Content Request/Response ============
export interface GenerateContentRequest {
  contents: Content[];
  generationConfig?: GenerationConfig;
  safetySettings?: SafetySetting[];
  systemInstruction?: Content;
}

export interface GenerateContentResponse {
  candidates: Candidate[];
  usageMetadata?: UsageMetadata;
  modelVersion?: string;
}

export interface Candidate {
  content: Content;
  finishReason?: string;
  safetyRatings?: SafetyRating[];
  citationMetadata?: CitationMetadata;
}

export interface SafetyRating {
  category: HarmCategory;
  probability: string;
}

export interface CitationMetadata {
  citations: Citation[];
}

export interface Citation {
  startIndex?: number;
  endIndex?: number;
  uri?: string;
  title?: string;
}

export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

// ============ Embeddings ============
export type EmbeddingTaskType =
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING'
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'CODE_RETRIEVAL_QUERY'
  | 'QUESTION_ANSWERING'
  | 'FACT_VERIFICATION';

export interface EmbedContentRequest {
  content: Content;
  taskType?: EmbeddingTaskType;
  title?: string;
  outputDimensionality?: number;
}

export interface EmbedContentResponse {
  embedding: {
    values: number[];
  };
}

export interface BatchEmbedContentsRequest {
  requests: EmbedContentRequest[];
}

export interface BatchEmbedContentsResponse {
  embeddings: { values: number[] }[];
}

// ============ Video Generation (Veo) ============
export interface VideoGenerationRequest {
  instances: VideoGenerationInstance[];
}

export interface VideoGenerationInstance {
  prompt: string;
  negativePrompt?: string;
  image?: {
    bytesBase64Encoded?: string;
    gcsUri?: string;
  };
  lastFrame?: {
    bytesBase64Encoded?: string;
    gcsUri?: string;
  };
  referenceImages?: {
    referenceImage: {
      bytesBase64Encoded?: string;
      gcsUri?: string;
    };
    referenceType: 'REFERENCE_TYPE_STYLE' | 'REFERENCE_TYPE_SUBJECT';
  }[];
  video?: {
    bytesBase64Encoded?: string;
    gcsUri?: string;
  };
}

export interface VideoGenerationParameters {
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p' | '4k';
  durationSeconds?: 4 | 6 | 8;
  personGeneration?: 'dont_allow' | 'allow_adult' | 'allow_all';
  generateAudio?: boolean;
  enhancePrompt?: boolean;
  storageUri?: string;
}

export interface VideoGenerationOperation {
  name: string;
  done: boolean;
  metadata?: {
    '@type': string;
  };
  response?: {
    generatedVideos: GeneratedVideo[];
  };
  error?: {
    code: number;
    message: string;
  };
}

export interface GeneratedVideo {
  video: {
    bytesBase64Encoded?: string;
    gcsUri?: string;
  };
}

// ============ Files API ============
export interface UploadedFile {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
  uri: string;
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
  error?: {
    code: number;
    message: string;
  };
}

export interface ListFilesResponse {
  files: UploadedFile[];
  nextPageToken?: string;
}

// ============ Token Counting ============
export interface CountTokensRequest {
  contents: Content[];
  generationConfig?: GenerationConfig;
}

export interface CountTokensResponse {
  totalTokens: number;
}

// ============ Config ============
export interface GeminiConfig {
  apiKey?: string;
  baseUrl?: string;
}
