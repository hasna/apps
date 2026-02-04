// Brandsight/GoDaddy Domain API Connector
// A TypeScript wrapper for domain management via the Brandsight/GoDaddy API

export { Brandsight } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  BrandsightClient,
  DomainsApi,
} from './api';
