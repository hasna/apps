import type { ListAttributesOptions } from '../types';
import type { UserpilotClient } from './client';

export class AttributesApi {
  constructor(private readonly client: UserpilotClient) {}

  list(options: ListAttributesOptions = {}): Promise<unknown> {
    return this.client.get('/attributes', options);
  }
}
