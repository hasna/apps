// Shadcn Connector Types

// ============================================
// Configuration
// ============================================

export interface ShadcnConfig {
  cwd?: string;  // Working directory for shadcn commands
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Component Types
// ============================================

export interface ShadcnComponent {
  name: string;
  description?: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files?: string[];
  type?: 'components:ui' | 'components:component' | 'components:example';
}

export interface ShadcnComponentListResponse {
  components: ShadcnComponent[];
}

export interface ShadcnAddOptions {
  components: string[];
  cwd?: string;
  overwrite?: boolean;
  all?: boolean;
  path?: string;
}

export interface ShadcnDiffOptions {
  component?: string;
  cwd?: string;
}

export interface ShadcnInitOptions {
  cwd?: string;
  defaults?: boolean;
  force?: boolean;
  srcDir?: boolean;
  componentsDir?: string;
  baseColor?: string;
  style?: 'default' | 'new-york';
}

// ============================================
// Command Result Types
// ============================================

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ============================================
// API Error Types
// ============================================

export interface ShadcnErrorDetail {
  code: string;
  message: string;
  component?: string;
}

export class ShadcnCliError extends Error {
  public readonly exitCode: number;
  public readonly stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = 'ShadcnCliError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}
