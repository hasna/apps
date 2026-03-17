// Monday.com Connector
// GraphQL API for workspaces, boards, items, and columns management

import { MondayClient } from './client';
import type {
  MondayConfig,
  User,
  Workspace,
  Board,
  Group,
  Item,
  Update,
  CreateBoardInput,
  CreateGroupInput,
  CreateItemInput,
} from '../types';

export { MondayClient } from './client';

interface UsersResponse {
  users: User[];
}

interface MeResponse {
  me: User;
}

interface WorkspacesResponse {
  workspaces: Workspace[];
}

interface BoardsResponse {
  boards: Board[];
}

interface ItemsResponse {
  items: Item[];
}

interface CreateBoardResponse {
  create_board: Board;
}

interface CreateGroupResponse {
  create_group: Group;
}

interface CreateItemResponse {
  create_item: Item;
}

interface ChangeColumnValueResponse {
  change_column_value: Item;
}

interface DeleteItemResponse {
  delete_item: { id: string };
}

interface CreateUpdateResponse {
  create_update: Update;
}

export class Monday {
  private client: MondayClient;

  constructor(config: MondayConfig) {
    this.client = new MondayClient(config);
  }

  // ============================================
  // User Operations
  // ============================================

  async me(): Promise<User> {
    const query = `
      query {
        me {
          id
          name
          email
          url
          photo_original
          title
          birthday
          country_code
          location
          time_zone_identifier
          phone
          mobile_phone
          is_guest
          is_pending
          is_admin
          is_view_only
          created_at
          account {
            id
            name
            logo
            slug
            tier
          }
        }
      }
    `;
    const result = await this.client.query<MeResponse>(query);
    return result.me;
  }

  async listUsers(options?: {
    limit?: number;
    kind?: 'all' | 'non_guests' | 'guests' | 'non_pending';
  }): Promise<User[]> {
    const query = `
      query($limit: Int, $kind: UserKind) {
        users(limit: $limit, kind: $kind) {
          id
          name
          email
          url
          photo_original
          title
          is_guest
          is_pending
          is_admin
          is_view_only
          created_at
        }
      }
    `;
    const result = await this.client.query<UsersResponse>(query, {
      limit: options?.limit,
      kind: options?.kind,
    });
    return result.users;
  }

  // ============================================
  // Workspace Operations
  // ============================================

  async listWorkspaces(options?: { limit?: number }): Promise<Workspace[]> {
    const query = `
      query($limit: Int) {
        workspaces(limit: $limit) {
          id
          name
          kind
          description
          created_at
        }
      }
    `;
    const result = await this.client.query<WorkspacesResponse>(query, {
      limit: options?.limit,
    });
    return result.workspaces;
  }

  // ============================================
  // Board Operations
  // ============================================

  async listBoards(options?: {
    limit?: number;
    workspace_ids?: number[];
    board_kind?: 'public' | 'private' | 'share';
    state?: 'active' | 'archived' | 'deleted' | 'all';
    order_by?: 'created_at' | 'used_at';
  }): Promise<Board[]> {
    const query = `
      query($limit: Int, $workspace_ids: [ID!], $board_kind: BoardKind, $state: State, $order_by: BoardsOrderBy) {
        boards(limit: $limit, workspace_ids: $workspace_ids, board_kind: $board_kind, state: $state, order_by: $order_by) {
          id
          name
          description
          board_folder_id
          board_kind
          state
          permissions
          workspace_id
          updated_at
          columns {
            id
            title
            type
            archived
            description
            settings_str
            width
          }
          groups {
            id
            title
            color
            position
            archived
            deleted
          }
          owner {
            id
            name
            email
          }
        }
      }
    `;
    const result = await this.client.query<BoardsResponse>(query, {
      limit: options?.limit,
      workspace_ids: options?.workspace_ids,
      board_kind: options?.board_kind,
      state: options?.state,
      order_by: options?.order_by,
    });
    return result.boards;
  }

  async getBoard(boardId: string | number): Promise<Board | null> {
    const query = `
      query($ids: [ID!]!) {
        boards(ids: $ids) {
          id
          name
          description
          board_folder_id
          board_kind
          state
          permissions
          workspace_id
          updated_at
          columns {
            id
            title
            type
            archived
            description
            settings_str
            width
          }
          groups {
            id
            title
            color
            position
            archived
            deleted
          }
          owner {
            id
            name
            email
          }
          subscribers {
            id
            name
            email
          }
          tags {
            id
            name
            color
          }
        }
      }
    `;
    const result = await this.client.query<BoardsResponse>(query, {
      ids: [boardId.toString()],
    });
    return result.boards[0] || null;
  }

  async createBoard(input: CreateBoardInput): Promise<Board> {
    const query = `
      mutation($board_name: String!, $board_kind: BoardKind!, $workspace_id: ID, $template_id: ID) {
        create_board(board_name: $board_name, board_kind: $board_kind, workspace_id: $workspace_id, template_id: $template_id) {
          id
          name
          description
          board_kind
          state
          workspace_id
        }
      }
    `;
    const result = await this.client.mutation<CreateBoardResponse>(query, {
      board_name: input.board_name,
      board_kind: input.board_kind,
      workspace_id: input.workspace_id,
      template_id: input.template_id,
    });
    return result.create_board;
  }

  // ============================================
  // Group Operations
  // ============================================

  async createGroup(input: CreateGroupInput): Promise<Group> {
    const query = `
      mutation($board_id: ID!, $group_name: String!, $relative_to: String, $position_relative_method: PositionRelative) {
        create_group(board_id: $board_id, group_name: $group_name, relative_to: $relative_to, position_relative_method: $position_relative_method) {
          id
          title
          color
          position
        }
      }
    `;
    const result = await this.client.mutation<CreateGroupResponse>(query, {
      board_id: input.board_id,
      group_name: input.group_name,
      relative_to: input.relative_to,
      position_relative_method: input.position_relative_method,
    });
    return result.create_group;
  }

  // ============================================
  // Item Operations
  // ============================================

  async listItems(boardId: string | number, options?: {
    limit?: number;
    group_id?: string;
  }): Promise<Item[]> {
    const query = `
      query($board_id: ID!, $limit: Int) {
        boards(ids: [$board_id]) {
          items_page(limit: $limit) {
            items {
              id
              name
              state
              created_at
              updated_at
              creator_id
              email
              relative_link
              group {
                id
                title
              }
              column_values {
                id
                text
                type
                value
              }
              subitems {
                id
                name
              }
            }
          }
        }
      }
    `;
    const result = await this.client.query<BoardsResponse>(query, {
      board_id: boardId.toString(),
      limit: options?.limit,
    });
    const board = result.boards[0];
    if (!board || !board.items_page) {
      return [];
    }
    let items = board.items_page.items;
    if (options?.group_id) {
      items = items.filter(item => item.group?.id === options.group_id);
    }
    return items;
  }

  async getItem(itemId: string | number): Promise<Item | null> {
    const query = `
      query($ids: [ID!]!) {
        items(ids: $ids) {
          id
          name
          state
          created_at
          updated_at
          creator_id
          email
          relative_link
          board {
            id
            name
          }
          group {
            id
            title
          }
          column_values {
            id
            text
            type
            value
            column {
              id
              title
              type
            }
          }
          subitems {
            id
            name
          }
          subscribers {
            id
            name
            email
          }
          updates {
            id
            body
            text_body
            created_at
            creator {
              id
              name
            }
          }
        }
      }
    `;
    const result = await this.client.query<ItemsResponse>(query, {
      ids: [itemId.toString()],
    });
    return result.items[0] || null;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const query = `
      mutation($board_id: ID!, $item_name: String!, $group_id: String, $column_values: JSON, $create_labels_if_missing: Boolean) {
        create_item(board_id: $board_id, item_name: $item_name, group_id: $group_id, column_values: $column_values, create_labels_if_missing: $create_labels_if_missing) {
          id
          name
          state
          created_at
          group {
            id
            title
          }
          column_values {
            id
            text
            type
            value
          }
        }
      }
    `;
    const result = await this.client.mutation<CreateItemResponse>(query, {
      board_id: input.board_id,
      item_name: input.item_name,
      group_id: input.group_id,
      column_values: input.column_values,
      create_labels_if_missing: input.create_labels_if_missing,
    });
    return result.create_item;
  }

  async updateItem(
    boardId: string | number,
    itemId: string | number,
    columnId: string,
    value: string
  ): Promise<Item> {
    const query = `
      mutation($board_id: ID!, $item_id: ID!, $column_id: String!, $value: JSON!) {
        change_column_value(board_id: $board_id, item_id: $item_id, column_id: $column_id, value: $value) {
          id
          name
          column_values {
            id
            text
            type
            value
          }
        }
      }
    `;
    const result = await this.client.mutation<ChangeColumnValueResponse>(query, {
      board_id: boardId.toString(),
      item_id: itemId.toString(),
      column_id: columnId,
      value: value,
    });
    return result.change_column_value;
  }

  async deleteItem(itemId: string | number): Promise<{ id: string }> {
    const query = `
      mutation($item_id: ID!) {
        delete_item(item_id: $item_id) {
          id
        }
      }
    `;
    const result = await this.client.mutation<DeleteItemResponse>(query, {
      item_id: itemId.toString(),
    });
    return result.delete_item;
  }

  // ============================================
  // Update (Comment) Operations
  // ============================================

  async createUpdate(itemId: string | number, body: string): Promise<Update> {
    const query = `
      mutation($item_id: ID!, $body: String!) {
        create_update(item_id: $item_id, body: $body) {
          id
          body
          text_body
          created_at
          creator {
            id
            name
          }
        }
      }
    `;
    const result = await this.client.mutation<CreateUpdateResponse>(query, {
      item_id: itemId.toString(),
      body: body,
    });
    return result.create_update;
  }

  // ============================================
  // Utility Methods
  // ============================================

  getClient(): MondayClient {
    return this.client;
  }
}
