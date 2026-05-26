import type { ShadcnConfig } from '../types';
import { ShadcnClient } from './client';
import { ComponentsApi } from './components';

/**
 * Main Shadcn Connector class
 * Provides programmatic access to shadcn CLI commands
 */
export class Shadcn {
  private readonly client: ShadcnClient;

  // API modules
  public readonly components: ComponentsApi;

  constructor(config: ShadcnConfig = {}) {
    this.client = new ShadcnClient(config);
    this.components = new ComponentsApi(this.client);
  }

  /**
   * Create a client with default configuration
   */
  static create(cwd?: string): Shadcn {
    return new Shadcn({ cwd });
  }

  /**
   * Get the current working directory
   */
  getCwd(): string {
    return this.client.getCwd();
  }

  /**
   * Get the underlying client for direct command execution
   */
  getClient(): ShadcnClient {
    return this.client;
  }

  /**
   * Execute a raw shadcn CLI command
   */
  async execute(args: string[]): Promise<string> {
    return this.client.run(args);
  }
}

export { ShadcnClient } from './client';
export { ComponentsApi } from './components';
