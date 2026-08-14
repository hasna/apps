import type { ZendeskClient } from './client';
import type {
  ZendeskGroup,
  ZendeskGroupResponse,
  ZendeskGroupsResponse,
  GroupListParams,
} from '../types';

/**
 * Zendesk Groups API
 * @see https://developer.zendesk.com/api-reference/ticketing/groups/groups/
 */
export class GroupsApi {
  constructor(private readonly client: ZendeskClient) {}

  /**
   * List all groups
   * @see https://developer.zendesk.com/api-reference/ticketing/groups/groups/#list-groups
   */
  async list(params?: GroupListParams): Promise<ZendeskGroup[]> {
    const response = await this.client.get<ZendeskGroupsResponse>('/groups.json', {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.groups;
  }

  /**
   * Get a group by ID
   * @see https://developer.zendesk.com/api-reference/ticketing/groups/groups/#show-group
   */
  async get(groupId: number): Promise<ZendeskGroup> {
    const response = await this.client.get<ZendeskGroupResponse>(`/groups/${groupId}.json`);
    return response.group;
  }

  /**
   * Get assignable groups (groups that tickets can be assigned to)
   * @see https://developer.zendesk.com/api-reference/ticketing/groups/groups/#list-assignable-groups
   */
  async listAssignable(params?: GroupListParams): Promise<ZendeskGroup[]> {
    const response = await this.client.get<ZendeskGroupsResponse>('/groups/assignable.json', {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.groups;
  }

  /**
   * List groups for a specific user
   * @see https://developer.zendesk.com/api-reference/ticketing/groups/groups/#list-groups
   */
  async listByUser(userId: number, params?: GroupListParams): Promise<ZendeskGroup[]> {
    const response = await this.client.get<ZendeskGroupsResponse>(`/users/${userId}/groups.json`, {
      page: params?.page,
      per_page: params?.per_page,
    });
    return response.groups;
  }
}
