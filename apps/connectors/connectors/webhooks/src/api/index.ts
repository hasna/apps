import { WebhooksClient } from './webhooks';
import { getDefaultUrl, getSigningSecret } from '../utils/config';

export { WebhooksClient } from './webhooks';

export function createWebhooksClient(): WebhooksClient {
  return new WebhooksClient({
    defaultUrl: getDefaultUrl(),
    signingSecret: getSigningSecret(),
  });
}

export type { WebhooksConfig } from '../types';
