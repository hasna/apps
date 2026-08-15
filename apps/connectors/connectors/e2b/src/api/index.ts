import type { E2BConfig } from '../types';
import { E2BClient } from './client';
import { SandboxApi } from './sandbox';
import { CodeApi } from './code';
import { FilesystemApi } from './filesystem';

/**
 * E2B API Client
 * Main class for interacting with the E2B Code Interpreter API
 */
export class E2B {
  private readonly client: E2BClient;

  // API modules
  public readonly sandbox: SandboxApi;
  public readonly code: CodeApi;
  public readonly filesystem: FilesystemApi;

  // Aliases for convenience
  public readonly sandboxes: SandboxApi;
  public readonly files: FilesystemApi;

  constructor(config: E2BConfig) {
    this.client = new E2BClient(config);
    this.sandbox = new SandboxApi(this.client);
    this.code = new CodeApi(this.client);
    this.filesystem = new FilesystemApi(this.client);

    // Aliases
    this.sandboxes = this.sandbox;
    this.files = this.filesystem;
  }

  /**
   * Create a client from environment variables
   * Looks for E2B_API_KEY and optionally E2B_BASE_URL
   */
  static fromEnv(): E2B {
    const apiKey = process.env.E2B_API_KEY;
    const baseUrl = process.env.E2B_BASE_URL;

    if (!apiKey) {
      throw new Error('E2B_API_KEY environment variable is required');
    }
    return new E2B({ apiKey, baseUrl });
  }

  /**
   * Get a preview of the API key (for debugging)
   */
  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): E2BClient {
    return this.client;
  }

  // ============================================
  // Convenience methods for common operations
  // ============================================

  /**
   * Create a new sandbox (shorthand)
   */
  async createSandbox(template?: string, timeout?: number) {
    return this.sandbox.create({ template, timeout });
  }

  /**
   * Execute code in a new sandbox (one-shot execution)
   * Creates a sandbox, runs the code, and returns the result
   * @param code - Code to execute
   * @param language - Programming language
   * @param cleanup - Whether to kill the sandbox after execution (default: true)
   */
  async run(code: string, language?: string, cleanup: boolean = true) {
    const sandboxInfo = await this.sandbox.create();
    try {
      return await this.code.execute(sandboxInfo.sandboxId, { code, language });
    } finally {
      if (cleanup) {
        try {
          await this.sandbox.kill(sandboxInfo.sandboxId);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Run Python code (one-shot)
   */
  async runPython(code: string, cleanup: boolean = true) {
    return this.run(code, 'python', cleanup);
  }

  /**
   * Run JavaScript code (one-shot)
   */
  async runJavaScript(code: string, cleanup: boolean = true) {
    return this.run(code, 'javascript', cleanup);
  }

  /**
   * Run a shell command (one-shot)
   */
  async runCommand(command: string, cleanup: boolean = true) {
    const sandboxInfo = await this.sandbox.create();
    try {
      return await this.code.runCommand(sandboxInfo.sandboxId, { command });
    } finally {
      if (cleanup) {
        try {
          await this.sandbox.kill(sandboxInfo.sandboxId);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
}

export { E2BClient } from './client';
export { SandboxApi } from './sandbox';
export { CodeApi } from './code';
export { FilesystemApi } from './filesystem';
