import { describe, test, expect } from 'bun:test';
import { Zendesk } from './index';
import { TicketsApi } from './tickets';
import { UsersApi } from './users';
import { OrganizationsApi } from './organizations';
import { GroupsApi } from './groups';
import { TicketFieldsApi } from './ticket-fields';
import { ViewsApi } from './views';
import { TriggersApi } from './triggers';
import { AutomationsApi } from './automations';
import { SlaPoliciesApi } from './slas';
import { WebhooksApi } from './webhooks';
import { MacrosApi } from './macros';
import { BrandsApi } from './brands';

describe('Zendesk', () => {
  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  describe('constructor', () => {
    test('creates instance with all API modules', () => {
      const zendesk = new Zendesk(mockConfig);

      // Core APIs
      expect(zendesk.tickets).toBeInstanceOf(TicketsApi);
      expect(zendesk.users).toBeInstanceOf(UsersApi);
      expect(zendesk.organizations).toBeInstanceOf(OrganizationsApi);
      expect(zendesk.groups).toBeInstanceOf(GroupsApi);

      // Configuration APIs
      expect(zendesk.ticketFields).toBeInstanceOf(TicketFieldsApi);
      expect(zendesk.brands).toBeInstanceOf(BrandsApi);

      // Business Rules APIs
      expect(zendesk.views).toBeInstanceOf(ViewsApi);
      expect(zendesk.triggers).toBeInstanceOf(TriggersApi);
      expect(zendesk.automations).toBeInstanceOf(AutomationsApi);
      expect(zendesk.slaPolicies).toBeInstanceOf(SlaPoliciesApi);
      expect(zendesk.macros).toBeInstanceOf(MacrosApi);

      // Integration APIs
      expect(zendesk.webhooks).toBeInstanceOf(WebhooksApi);
    });
  });

  describe('fromEnv', () => {
    test('throws error when environment variables are missing', () => {
      const originalEmail = process.env.ZENDESK_EMAIL;
      const originalToken = process.env.ZENDESK_API_TOKEN;

      delete process.env.ZENDESK_EMAIL;
      delete process.env.ZENDESK_API_TOKEN;

      expect(() => Zendesk.fromEnv()).toThrow('ZENDESK_EMAIL and ZENDESK_API_TOKEN environment variables are required');

      // Restore
      if (originalEmail) process.env.ZENDESK_EMAIL = originalEmail;
      if (originalToken) process.env.ZENDESK_API_TOKEN = originalToken;
    });

    test('creates instance from environment variables', () => {
      const originalEmail = process.env.ZENDESK_EMAIL;
      const originalToken = process.env.ZENDESK_API_TOKEN;
      const originalUrl = process.env.ZENDESK_BASE_URL;

      process.env.ZENDESK_EMAIL = 'env@example.com';
      process.env.ZENDESK_API_TOKEN = 'env-token-12345';
      process.env.ZENDESK_BASE_URL = 'https://env.zendesk.com/api/v2';

      const zendesk = Zendesk.fromEnv();

      expect(zendesk).toBeInstanceOf(Zendesk);
      expect(zendesk.getEmail()).toBe('env@example.com');

      // Restore
      if (originalEmail) process.env.ZENDESK_EMAIL = originalEmail;
      else delete process.env.ZENDESK_EMAIL;
      if (originalToken) process.env.ZENDESK_API_TOKEN = originalToken;
      else delete process.env.ZENDESK_API_TOKEN;
      if (originalUrl) process.env.ZENDESK_BASE_URL = originalUrl;
      else delete process.env.ZENDESK_BASE_URL;
    });
  });

  describe('getApiTokenPreview', () => {
    test('returns masked token', () => {
      const zendesk = new Zendesk(mockConfig);
      const preview = zendesk.getApiTokenPreview();
      expect(preview).toBe('test-a...2345');
    });
  });

  describe('getEmail', () => {
    test('returns configured email', () => {
      const zendesk = new Zendesk(mockConfig);
      expect(zendesk.getEmail()).toBe('test@example.com');
    });
  });

  describe('getClient', () => {
    test('returns the underlying client', () => {
      const zendesk = new Zendesk(mockConfig);
      const client = zendesk.getClient();
      expect(client).toBeDefined();
      expect(client.getEmail()).toBe('test@example.com');
    });
  });
});
