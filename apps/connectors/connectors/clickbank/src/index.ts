// ClickBank API Connector
// A TypeScript wrapper for the ClickBank API

export { ClickBank } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ClickBankClient,
  OrdersApi,
  ProductsApi,
  TicketsApi,
  ShippingApi,
  QuickstatsApi,
  AnalyticsApi,
  ImagesApi,
} from './api';
