// E2B Code Interpreter API Types

// ============================================
// Configuration
// ============================================

export interface E2BConfig {
  apiKey: string;
  baseUrl?: string; // Override default base URL (https://api.e2b.dev)
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export type SandboxTemplate = 'base' | 'python' | 'nodejs' | 'go' | 'rust' | 'java' | 'php' | 'dotnet' | string;

export type Language = 'python' | 'javascript' | 'typescript' | 'bash' | 'go' | 'rust' | 'java' | 'php' | 'perl' | 'dotnet' | string;

// ============================================
// Sandbox Types
// ============================================

export interface SandboxMetadata {
  [key: string]: string;
}

export interface SandboxInfo {
  sandboxId: string;
  templateId: string;
  alias?: string;
  clientId: string;
  startedAt: string;
  endAt: string;
  metadata?: SandboxMetadata;
}

export interface SandboxCreateOptions {
  template?: SandboxTemplate;
  timeout?: number; // Timeout in milliseconds (max 24h for Pro, 1h for Hobby)
  metadata?: SandboxMetadata;
  envs?: Record<string, string>;
}

export interface SandboxListResponse {
  sandboxes: SandboxInfo[];
}

export interface SandboxKeepAliveOptions {
  timeout: number; // New timeout in milliseconds
}

// ============================================
// Code Execution Types
// ============================================

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
  error?: string;
}

export interface ExecuteCodeOptions {
  code: string;
  language?: Language;
  workDir?: string;
  envs?: Record<string, string>;
  timeout?: number;
}

export interface ExecuteCommandOptions {
  command: string;
  workDir?: string;
  envs?: Record<string, string>;
  timeout?: number;
  background?: boolean;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  status: 'running' | 'finished' | 'error';
  exitCode?: number;
}

// ============================================
// Filesystem Types
// ============================================

export interface FileInfo {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  modTime?: string;
}

export interface DirectoryListing {
  path: string;
  entries: FileInfo[];
}

export interface FileWriteOptions {
  path: string;
  content: string;
}

export interface FileReadResult {
  path: string;
  content: string;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class E2BApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: ApiErrorDetail[];

  constructor(message: string, statusCode: number, errors?: ApiErrorDetail[]) {
    super(message);
    this.name = 'E2BApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
