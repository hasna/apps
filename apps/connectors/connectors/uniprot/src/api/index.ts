import { UniProtClient } from './client';

export class UniProt {
  public readonly client: UniProtClient;

  constructor() {
    this.client = new UniProtClient();
  }

  get searchProteins() {
    return this.client.searchProteins.bind(this.client);
  }

  get getProtein() {
    return this.client.getProtein.bind(this.client);
  }

  get searchProteomes() {
    return this.client.searchProteomes.bind(this.client);
  }
}

export { UniProtClient } from './client';
export { UniProt as Connector };
