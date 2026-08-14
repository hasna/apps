// Zendesk API Connector
// A TypeScript wrapper for the Zendesk API

export { Zendesk } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ZendeskClient,
  TicketsApi,
  UsersApi,
  OrganizationsApi,
  GroupsApi,
  TicketFieldsApi,
  ViewsApi,
  TriggersApi,
  AutomationsApi,
  SlaPoliciesApi,
  WebhooksApi,
  MacrosApi,
  BrandsApi,
  BulkApi,
  FilterParser,
} from './api';

// Re-export bulk operation types
export type {
  BulkUpdateOptions,
  BulkUpdateResult,
  BulkPreviewResult,
  BulkSchema,
  BulkResourceType,
  ParsedFilter,
  ParsedUpdate,
  FieldSchema,
} from './api';
