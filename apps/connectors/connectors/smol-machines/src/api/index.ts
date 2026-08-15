import type { SmolMachinesConfig } from '../types';
import { SmolMachinesClient } from './client';
import { MachinesApi } from './machines';

export class SmolMachines {
  readonly machines: MachinesApi;
  private readonly client: SmolMachinesClient;

  constructor(config: SmolMachinesConfig = {}) {
    this.client = new SmolMachinesClient(config);
    this.machines = new MachinesApi(this.client);
  }

  static fromEnv(): SmolMachines {
    return new SmolMachines({
      apiKey: process.env.SMOL_MACHINES_API_KEY,
      baseUrl: process.env.SMOL_MACHINES_BASE_URL,
    });
  }

  getClient(): SmolMachinesClient {
    return this.client;
  }
}

export { SmolMachinesClient, DEFAULT_BASE_URL } from './client';
export { MachinesApi } from './machines';
