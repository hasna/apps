import type { LinearClient } from './client';
import type { LinearUser, UsersResponse, UserResponse, ViewerResponse, ListOptions } from '../types';

const USER_FRAGMENT = `
  fragment UserFragment on User {
    id
    name
    displayName
    email
    avatarUrl
    active
    admin
    createdAt
    updatedAt
  }
`;

export class UsersApi {
  constructor(private readonly client: LinearClient) {}

  /**
   * List all users
   */
  async list(options: ListOptions = {}): Promise<LinearUser[]> {
    const { first = 100, after } = options;

    const query = `
      ${USER_FRAGMENT}
      query Users($first: Int, $after: String) {
        users(first: $first, after: $after) {
          nodes {
            ...UserFragment
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const result = await this.client.query<UsersResponse>(query, {
      first,
      after,
    });

    return result.users.nodes;
  }

  /**
   * Get a single user by ID
   */
  async get(id: string): Promise<LinearUser> {
    const query = `
      ${USER_FRAGMENT}
      query User($id: String!) {
        user(id: $id) {
          ...UserFragment
        }
      }
    `;

    const result = await this.client.query<UserResponse>(query, { id });
    return result.user;
  }

  /**
   * Get the currently authenticated user
   */
  async me(): Promise<LinearUser> {
    const query = `
      ${USER_FRAGMENT}
      query Viewer {
        viewer {
          ...UserFragment
        }
      }
    `;

    const result = await this.client.query<ViewerResponse>(query);
    return result.viewer;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<LinearUser | undefined> {
    const users = await this.list();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  /**
   * Find user by name or display name
   */
  async findByName(name: string): Promise<LinearUser | undefined> {
    const users = await this.list();
    const lowerName = name.toLowerCase();
    return users.find(
      u =>
        u.name.toLowerCase() === lowerName ||
        u.displayName.toLowerCase() === lowerName
    );
  }

  /**
   * List only active users
   */
  async listActive(options: ListOptions = {}): Promise<LinearUser[]> {
    const users = await this.list(options);
    return users.filter(u => u.active);
  }
}
