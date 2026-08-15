import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { TicketsApi } from './tickets';
import { ZendeskClient } from './client';

describe('TicketsApi', () => {
  let client: ZendeskClient;
  let ticketsApi: TicketsApi;
  let originalFetch: typeof global.fetch;

  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  beforeEach(() => {
    client = new ZendeskClient(mockConfig);
    ticketsApi = new TicketsApi(client);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const mockFetch = (response: unknown, status = 200) => {
    global.fetch = mock(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as Response)
    );
  };

  describe('list', () => {
    test('returns list of tickets', async () => {
      const mockTickets = [
        { id: 1, subject: 'Ticket 1', status: 'open' },
        { id: 2, subject: 'Ticket 2', status: 'pending' },
      ];
      mockFetch({ tickets: mockTickets });

      const result = await ticketsApi.list();

      expect(result).toEqual(mockTickets);
    });

    test('passes pagination params', async () => {
      mockFetch({ tickets: [] });

      await ticketsApi.list({ page: 2, per_page: 50 });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('page=2');
      expect(url).toContain('per_page=50');
    });

    test('passes sort params', async () => {
      mockFetch({ tickets: [] });

      await ticketsApi.list({ sort_by: 'updated_at', sort_order: 'desc' });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('sort_by=updated_at');
      expect(url).toContain('sort_order=desc');
    });
  });

  describe('get', () => {
    test('returns a single ticket', async () => {
      const mockTicket = { id: 123, subject: 'Test Ticket', status: 'open' };
      mockFetch({ ticket: mockTicket });

      const result = await ticketsApi.get(123);

      expect(result).toEqual(mockTicket);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/tickets/123.json');
    });
  });

  describe('create', () => {
    test('creates a new ticket', async () => {
      const newTicket = { id: 456, subject: 'New Ticket', status: 'new' };
      mockFetch({ ticket: newTicket }, 201);

      const result = await ticketsApi.create({
        ticket: {
          subject: 'New Ticket',
          comment: { body: 'Description' },
        },
      });

      expect(result).toEqual(newTicket);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/tickets.json');
      expect(options.method).toBe('POST');
    });

    test('creates ticket with full payload', async () => {
      mockFetch({ ticket: { id: 1 } }, 201);

      await ticketsApi.create({
        ticket: {
          subject: 'Test',
          comment: { body: 'Description', public: true },
          priority: 'high',
          type: 'problem',
          status: 'open',
          tags: ['urgent', 'vip'],
          assignee_id: 123,
          group_id: 456,
        },
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.ticket.priority).toBe('high');
      expect(body.ticket.type).toBe('problem');
      expect(body.ticket.tags).toEqual(['urgent', 'vip']);
    });
  });

  describe('update', () => {
    test('updates a ticket', async () => {
      const updatedTicket = { id: 123, subject: 'Updated', status: 'pending' };
      mockFetch({ ticket: updatedTicket });

      const result = await ticketsApi.update(123, {
        ticket: { status: 'pending' },
      });

      expect(result).toEqual(updatedTicket);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/tickets/123.json');
      expect(options.method).toBe('PUT');
    });

    test('updates ticket with comment', async () => {
      mockFetch({ ticket: { id: 123 } });

      await ticketsApi.update(123, {
        ticket: {
          status: 'solved',
          comment: { body: 'This is resolved', public: true },
        },
      });

      const [, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.ticket.comment.body).toBe('This is resolved');
    });
  });

  describe('delete', () => {
    test('deletes a ticket', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      await ticketsApi.delete(123);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/tickets/123.json');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('listByUser', () => {
    test('lists tickets for a user', async () => {
      const mockTickets = [{ id: 1, requester_id: 456 }];
      mockFetch({ tickets: mockTickets });

      const result = await ticketsApi.listByUser(456);

      expect(result).toEqual(mockTickets);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/456/tickets/requested.json');
    });
  });

  describe('listByOrganization', () => {
    test('lists tickets for an organization', async () => {
      const mockTickets = [{ id: 1, organization_id: 789 }];
      mockFetch({ tickets: mockTickets });

      const result = await ticketsApi.listByOrganization(789);

      expect(result).toEqual(mockTickets);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/organizations/789/tickets.json');
    });
  });

  describe('search', () => {
    test('searches tickets with query', async () => {
      const mockTickets = [{ id: 1, subject: 'Error in login' }];
      mockFetch({ tickets: mockTickets });

      const result = await ticketsApi.search('login error');

      expect(result).toEqual(mockTickets);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/search.json');
      expect(url).toContain('query=type%3Aticket+login+error');
    });
  });
});
