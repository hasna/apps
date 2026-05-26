import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { UsersApi } from './users';
import { ZendeskClient } from './client';

describe('UsersApi', () => {
  let client: ZendeskClient;
  let usersApi: UsersApi;
  let originalFetch: typeof global.fetch;

  const mockConfig = {
    email: 'test@example.com',
    apiToken: 'test-api-token-12345',
    baseUrl: 'https://test.zendesk.com/api/v2',
  };

  beforeEach(() => {
    client = new ZendeskClient(mockConfig);
    usersApi = new UsersApi(client);
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
    test('returns list of users', async () => {
      const mockUsers = [
        { id: 1, name: 'User 1', email: 'user1@example.com', role: 'end-user' },
        { id: 2, name: 'User 2', email: 'user2@example.com', role: 'agent' },
      ];
      mockFetch({ users: mockUsers });

      const result = await usersApi.list();

      expect(result).toEqual(mockUsers);
    });

    test('filters by role', async () => {
      mockFetch({ users: [] });

      await usersApi.list({ role: 'agent' });

      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('role=agent');
    });
  });

  describe('get', () => {
    test('returns a single user', async () => {
      const mockUser = { id: 123, name: 'Test User', email: 'test@example.com', role: 'end-user' };
      mockFetch({ user: mockUser });

      const result = await usersApi.get(123);

      expect(result).toEqual(mockUser);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/123.json');
    });
  });

  describe('me', () => {
    test('returns current authenticated user', async () => {
      const mockUser = { id: 999, name: 'Current User', email: 'me@example.com', role: 'admin' };
      mockFetch({ user: mockUser });

      const result = await usersApi.me();

      expect(result).toEqual(mockUser);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/me.json');
    });
  });

  describe('create', () => {
    test('creates a new user', async () => {
      const newUser = { id: 456, name: 'New User', email: 'new@example.com', role: 'end-user' };
      mockFetch({ user: newUser }, 201);

      const result = await usersApi.create({
        user: {
          name: 'New User',
          email: 'new@example.com',
        },
      });

      expect(result).toEqual(newUser);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users.json');
      expect(options.method).toBe('POST');
    });
  });

  describe('update', () => {
    test('updates a user', async () => {
      const updatedUser = { id: 123, name: 'Updated Name', email: 'test@example.com', role: 'agent' };
      mockFetch({ user: updatedUser });

      const result = await usersApi.update(123, {
        user: { name: 'Updated Name', role: 'agent' },
      });

      expect(result).toEqual(updatedUser);
      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/123.json');
      expect(options.method).toBe('PUT');
    });
  });

  describe('delete', () => {
    test('deletes a user', async () => {
      global.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          status: 204,
          headers: new Headers({}),
          text: () => Promise.resolve(''),
        } as Response)
      );

      await usersApi.delete(123);

      const [url, options] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/123.json');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('searchByEmail', () => {
    test('searches users by email', async () => {
      const mockUsers = [{ id: 1, email: 'test@example.com' }];
      mockFetch({ users: mockUsers });

      const result = await usersApi.searchByEmail('test@example.com');

      expect(result).toEqual(mockUsers);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/search.json');
      expect(url).toContain('query=test%40example.com');
    });
  });

  describe('searchByName', () => {
    test('searches users by name', async () => {
      const mockUsers = [{ id: 1, name: 'John Doe' }];
      mockFetch({ users: mockUsers });

      const result = await usersApi.searchByName('John');

      expect(result).toEqual(mockUsers);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/users/search.json');
      expect(url).toContain('query=John');
    });
  });

  describe('listByOrganization', () => {
    test('lists users for an organization', async () => {
      const mockUsers = [{ id: 1, organization_id: 789 }];
      mockFetch({ users: mockUsers });

      const result = await usersApi.listByOrganization(789);

      expect(result).toEqual(mockUsers);
      const [url] = (global.fetch as ReturnType<typeof mock>).mock.calls[0];
      expect(url).toContain('/organizations/789/users.json');
    });
  });
});
