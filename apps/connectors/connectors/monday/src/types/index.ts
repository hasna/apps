// Monday.com Connector Types
// Workspaces, boards, items, and columns management

// ============================================
// Configuration
// ============================================

export interface MondayConfig {
  apiKey: string;
  baseUrl?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface MondayGraphQLResponse<T> {
  data?: T;
  errors?: MondayError[];
  account_id?: number;
}

export interface MondayError {
  message: string;
  locations?: { line: number; column: number }[];
  path?: string[];
  extensions?: Record<string, unknown>;
}

// ============================================
// User Types
// ============================================

export interface User {
  id: string;
  name: string;
  email: string;
  url?: string;
  photo_original?: string;
  photo_small?: string;
  photo_thumb?: string;
  title?: string;
  birthday?: string;
  country_code?: string;
  location?: string;
  time_zone_identifier?: string;
  phone?: string;
  mobile_phone?: string;
  is_guest?: boolean;
  is_pending?: boolean;
  is_admin?: boolean;
  is_view_only?: boolean;
  created_at?: string;
  account?: Account;
  teams?: Team[];
}

export interface Account {
  id: string;
  name: string;
  logo?: string;
  show_timeline_weekends?: boolean;
  slug?: string;
  tier?: string;
  plan?: {
    max_users?: number;
    period?: string;
    tier?: string;
    version?: number;
  };
}

export interface Team {
  id: string;
  name: string;
  picture_url?: string;
  users?: User[];
}

// ============================================
// Workspace Types
// ============================================

export interface Workspace {
  id: string;
  name: string;
  kind?: 'open' | 'closed';
  description?: string;
  created_at?: string;
  account_product?: {
    id: string;
    kind?: string;
  };
}

// ============================================
// Board Types
// ============================================

export interface Board {
  id: string;
  name: string;
  description?: string;
  board_folder_id?: string;
  board_kind?: 'public' | 'private' | 'share';
  columns?: Column[];
  groups?: Group[];
  items_page?: {
    cursor?: string;
    items: Item[];
  };
  owner?: User;
  permissions?: string;
  state?: 'active' | 'archived' | 'deleted' | 'all';
  subscribers?: User[];
  tags?: Tag[];
  type?: string;
  updated_at?: string;
  workspace?: Workspace;
  workspace_id?: string;
}

export interface CreateBoardInput {
  board_name: string;
  board_kind: 'public' | 'private' | 'share';
  workspace_id?: number;
  template_id?: number;
  board_owner_ids?: number[];
  board_subscriber_ids?: number[];
}

// ============================================
// Column Types
// ============================================

export interface Column {
  id: string;
  title: string;
  type: string;
  archived?: boolean;
  description?: string;
  settings_str?: string;
  width?: number;
}

// ============================================
// Group Types
// ============================================

export interface Group {
  id: string;
  title: string;
  color?: string;
  position?: string;
  archived?: boolean;
  deleted?: boolean;
  items_page?: {
    cursor?: string;
    items: Item[];
  };
}

export interface CreateGroupInput {
  board_id: number;
  group_name: string;
  relative_to?: string;
  position_relative_method?: 'before_at' | 'after_at';
}

// ============================================
// Item Types
// ============================================

export interface Item {
  id: string;
  name: string;
  board?: Board;
  column_values?: ColumnValue[];
  created_at?: string;
  creator?: User;
  creator_id?: string;
  email?: string;
  group?: Group;
  parent_item?: Item;
  relative_link?: string;
  state?: 'active' | 'archived' | 'deleted' | 'all';
  subitems?: Item[];
  subscribers?: User[];
  updated_at?: string;
  updates?: Update[];
}

export interface ColumnValue {
  id: string;
  text?: string;
  type: string;
  value?: string;
  column?: Column;
}

export interface CreateItemInput {
  board_id: number;
  item_name: string;
  group_id?: string;
  column_values?: string; // JSON string
  create_labels_if_missing?: boolean;
}

// ============================================
// Update Types
// ============================================

export interface Update {
  id: string;
  body?: string;
  text_body?: string;
  created_at?: string;
  creator?: User;
  creator_id?: string;
  item_id?: string;
  replies?: Reply[];
  updated_at?: string;
}

export interface Reply {
  id: string;
  body?: string;
  text_body?: string;
  created_at?: string;
  creator?: User;
  creator_id?: string;
  updated_at?: string;
}

// ============================================
// Tag Types
// ============================================

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

// ============================================
// Activity Log Types
// ============================================

export interface ActivityLog {
  id: string;
  entity: string;
  event: string;
  created_at?: string;
  user_id?: string;
  data?: string;
}

// ============================================
// API Error Types
// ============================================

export class MondayApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: MondayError[];

  constructor(message: string, statusCode: number, errors?: MondayError[]) {
    super(message);
    this.name = 'MondayApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
