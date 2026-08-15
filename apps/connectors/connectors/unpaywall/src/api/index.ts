import { UnpaywallClient } from './client';
import { getEmail } from '../utils/config';

export class Unpaywall {
  public readonly client: UnpaywallClient;

  constructor(email?: string) {
    const resolved = email || getEmail();
    if (!resolved) {
      throw new Error(
        'Unpaywall email is required. Set UNPAYWALL_EMAIL or run: connect-unpaywall config set-email <email>',
      );
    }
    this.client = new UnpaywallClient(resolved);
  }

  get getDoi() {
    return this.client.getDoi.bind(this.client);
  }

  get search() {
    return this.client.search.bind(this.client);
  }
}

export { UnpaywallClient } from './client';
export { Unpaywall as Connector };
