import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CommandsApi } from './commands';
import { TriggerApi } from './trigger';
import { RunsApi } from './runs';
import { ComputersApi } from './computers';

/**
 * TRIGGERcmd API Connector
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly commands: CommandsApi;
  public readonly trigger: TriggerApi;
  public readonly runs: RunsApi;
  public readonly computers: ComputersApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.commands = new CommandsApi(this.client);
    this.trigger = new TriggerApi(this.client);
    this.runs = new RunsApi(this.client);
    this.computers = new ComputersApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TRIGGERCMD_API_KEY || process.env.TRIGGERCMD_TOKEN;

    if (!apiKey) {
      throw new Error('TRIGGERCMD_API_KEY environment variable is required');
    }
    return new Connector({ apiKey });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { CommandsApi } from './commands';
export { TriggerApi } from './trigger';
export { RunsApi } from './runs';
export { ComputersApi } from './computers';
