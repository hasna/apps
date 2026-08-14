import { ZenodoClient } from './client';
import type { ConnectorConfig } from '../types';

export class Zenodo {
  public readonly client: ZenodoClient;

  constructor(config: ConnectorConfig = {}) {
    this.client = new ZenodoClient(config);
  }

  get searchRecords() {
    return this.client.searchRecords.bind(this.client);
  }

  get getRecord() {
    return this.client.getRecord.bind(this.client);
  }

  get listDepositions() {
    return this.client.listDepositions.bind(this.client);
  }

  get getDeposition() {
    return this.client.getDeposition.bind(this.client);
  }

  get createDeposition() {
    return this.client.createDeposition.bind(this.client);
  }

  get updateDeposition() {
    return this.client.updateDeposition.bind(this.client);
  }

  get publishDeposition() {
    return this.client.publishDeposition.bind(this.client);
  }
}

export { ZenodoClient } from './client';
export { Zenodo as Connector };
