// Notion API Connector Types

// ============================================
// Configuration
// ============================================

export interface NotionConfig {
  accessToken: string;
  baseUrl?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  botId?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceIcon?: string;
  ownerType?: string;
  ownerUserId?: string;
}

export interface CliConfig {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  workspaceId?: string;
  workspaceName?: string;
  botId?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'table' | 'pretty';

export interface PaginatedResponse<T> {
  object: 'list';
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
  type?: string;
}

// ============================================
// Rich Text Types
// ============================================

export interface RichTextBase {
  plain_text: string;
  href: string | null;
  annotations: {
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    underline: boolean;
    code: boolean;
    color: string;
  };
}

export interface RichTextText extends RichTextBase {
  type: 'text';
  text: {
    content: string;
    link: { url: string } | null;
  };
}

export interface RichTextMention extends RichTextBase {
  type: 'mention';
  mention: {
    type: 'user' | 'page' | 'database' | 'date' | 'link_preview';
    [key: string]: unknown;
  };
}

export interface RichTextEquation extends RichTextBase {
  type: 'equation';
  equation: {
    expression: string;
  };
}

export type RichText = RichTextText | RichTextMention | RichTextEquation;

// ============================================
// User Types
// ============================================

export interface NotionUser {
  object: 'user';
  id: string;
  type?: 'person' | 'bot';
  name?: string;
  avatar_url?: string | null;
  person?: {
    email?: string;
  };
  bot?: {
    owner?: {
      type: 'workspace' | 'user';
      workspace?: boolean;
      user?: NotionUser;
    };
    workspace_name?: string;
  };
}

// ============================================
// Parent Types
// ============================================

export type Parent =
  | { type: 'database_id'; database_id: string }
  | { type: 'page_id'; page_id: string }
  | { type: 'block_id'; block_id: string }
  | { type: 'workspace'; workspace: true };

// ============================================
// Property Types
// ============================================

export interface PropertyValue {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface TitleProperty extends PropertyValue {
  type: 'title';
  title: RichText[];
}

export interface RichTextProperty extends PropertyValue {
  type: 'rich_text';
  rich_text: RichText[];
}

export interface NumberProperty extends PropertyValue {
  type: 'number';
  number: number | null;
}

export interface SelectProperty extends PropertyValue {
  type: 'select';
  select: { id: string; name: string; color: string } | null;
}

export interface MultiSelectProperty extends PropertyValue {
  type: 'multi_select';
  multi_select: Array<{ id: string; name: string; color: string }>;
}

export interface DateProperty extends PropertyValue {
  type: 'date';
  date: {
    start: string;
    end: string | null;
    time_zone: string | null;
  } | null;
}

export interface CheckboxProperty extends PropertyValue {
  type: 'checkbox';
  checkbox: boolean;
}

export interface UrlProperty extends PropertyValue {
  type: 'url';
  url: string | null;
}

export interface EmailProperty extends PropertyValue {
  type: 'email';
  email: string | null;
}

export interface PhoneNumberProperty extends PropertyValue {
  type: 'phone_number';
  phone_number: string | null;
}

export interface PeopleProperty extends PropertyValue {
  type: 'people';
  people: NotionUser[];
}

export interface FilesProperty extends PropertyValue {
  type: 'files';
  files: Array<{
    name: string;
    type: 'file' | 'external';
    file?: { url: string; expiry_time: string };
    external?: { url: string };
  }>;
}

export interface RelationProperty extends PropertyValue {
  type: 'relation';
  relation: Array<{ id: string }>;
  has_more?: boolean;
}

export interface FormulaProperty extends PropertyValue {
  type: 'formula';
  formula: {
    type: 'string' | 'number' | 'boolean' | 'date';
    string?: string;
    number?: number;
    boolean?: boolean;
    date?: { start: string; end: string | null };
  };
}

export interface RollupProperty extends PropertyValue {
  type: 'rollup';
  rollup: {
    type: 'number' | 'date' | 'array' | 'unsupported' | 'incomplete';
    number?: number;
    date?: { start: string; end: string | null };
    array?: PropertyValue[];
    function: string;
  };
}

export interface StatusProperty extends PropertyValue {
  type: 'status';
  status: { id: string; name: string; color: string } | null;
}

export interface CreatedTimeProperty extends PropertyValue {
  type: 'created_time';
  created_time: string;
}

export interface CreatedByProperty extends PropertyValue {
  type: 'created_by';
  created_by: NotionUser;
}

export interface LastEditedTimeProperty extends PropertyValue {
  type: 'last_edited_time';
  last_edited_time: string;
}

export interface LastEditedByProperty extends PropertyValue {
  type: 'last_edited_by';
  last_edited_by: NotionUser;
}

// ============================================
// Database Types
// ============================================

export interface DatabasePropertyConfig {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface NotionDatabase {
  object: 'database';
  id: string;
  created_time: string;
  created_by: NotionUser;
  last_edited_time: string;
  last_edited_by: NotionUser;
  title: RichText[];
  description: RichText[];
  icon: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } } | null;
  cover: { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } } | null;
  properties: Record<string, DatabasePropertyConfig>;
  parent: Parent;
  url: string;
  archived: boolean;
  is_inline: boolean;
  public_url: string | null;
}

// ============================================
// Page Types
// ============================================

export interface NotionPage {
  object: 'page';
  id: string;
  created_time: string;
  created_by: NotionUser;
  last_edited_time: string;
  last_edited_by: NotionUser;
  archived: boolean;
  icon: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } } | null;
  cover: { type: 'external'; external: { url: string } } | { type: 'file'; file: { url: string } } | null;
  properties: Record<string, PropertyValue>;
  parent: Parent;
  url: string;
  public_url: string | null;
}

// ============================================
// Block Types
// ============================================

export interface BlockBase {
  object: 'block';
  id: string;
  parent: Parent;
  created_time: string;
  created_by: NotionUser;
  last_edited_time: string;
  last_edited_by: NotionUser;
  has_children: boolean;
  archived: boolean;
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph';
  paragraph: {
    rich_text: RichText[];
    color: string;
  };
}

export interface Heading1Block extends BlockBase {
  type: 'heading_1';
  heading_1: {
    rich_text: RichText[];
    color: string;
    is_toggleable: boolean;
  };
}

export interface Heading2Block extends BlockBase {
  type: 'heading_2';
  heading_2: {
    rich_text: RichText[];
    color: string;
    is_toggleable: boolean;
  };
}

export interface Heading3Block extends BlockBase {
  type: 'heading_3';
  heading_3: {
    rich_text: RichText[];
    color: string;
    is_toggleable: boolean;
  };
}

export interface BulletedListItemBlock extends BlockBase {
  type: 'bulleted_list_item';
  bulleted_list_item: {
    rich_text: RichText[];
    color: string;
  };
}

export interface NumberedListItemBlock extends BlockBase {
  type: 'numbered_list_item';
  numbered_list_item: {
    rich_text: RichText[];
    color: string;
  };
}

export interface ToDoBlock extends BlockBase {
  type: 'to_do';
  to_do: {
    rich_text: RichText[];
    checked: boolean;
    color: string;
  };
}

export interface ToggleBlock extends BlockBase {
  type: 'toggle';
  toggle: {
    rich_text: RichText[];
    color: string;
  };
}

export interface CodeBlock extends BlockBase {
  type: 'code';
  code: {
    rich_text: RichText[];
    caption: RichText[];
    language: string;
  };
}

export interface QuoteBlock extends BlockBase {
  type: 'quote';
  quote: {
    rich_text: RichText[];
    color: string;
  };
}

export interface CalloutBlock extends BlockBase {
  type: 'callout';
  callout: {
    rich_text: RichText[];
    icon: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } } | null;
    color: string;
  };
}

export interface DividerBlock extends BlockBase {
  type: 'divider';
  divider: Record<string, never>;
}

export interface TableOfContentsBlock extends BlockBase {
  type: 'table_of_contents';
  table_of_contents: {
    color: string;
  };
}

export interface ChildPageBlock extends BlockBase {
  type: 'child_page';
  child_page: {
    title: string;
  };
}

export interface ChildDatabaseBlock extends BlockBase {
  type: 'child_database';
  child_database: {
    title: string;
  };
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  image: {
    type: 'file' | 'external';
    file?: { url: string; expiry_time: string };
    external?: { url: string };
    caption: RichText[];
  };
}

export interface VideoBlock extends BlockBase {
  type: 'video';
  video: {
    type: 'file' | 'external';
    file?: { url: string; expiry_time: string };
    external?: { url: string };
    caption: RichText[];
  };
}

export interface FileBlock extends BlockBase {
  type: 'file';
  file: {
    type: 'file' | 'external';
    file?: { url: string; expiry_time: string };
    external?: { url: string };
    caption: RichText[];
    name: string;
  };
}

export interface PdfBlock extends BlockBase {
  type: 'pdf';
  pdf: {
    type: 'file' | 'external';
    file?: { url: string; expiry_time: string };
    external?: { url: string };
    caption: RichText[];
  };
}

export interface BookmarkBlock extends BlockBase {
  type: 'bookmark';
  bookmark: {
    url: string;
    caption: RichText[];
  };
}

export interface EmbedBlock extends BlockBase {
  type: 'embed';
  embed: {
    url: string;
    caption: RichText[];
  };
}

export interface LinkPreviewBlock extends BlockBase {
  type: 'link_preview';
  link_preview: {
    url: string;
  };
}

export interface EquationBlock extends BlockBase {
  type: 'equation';
  equation: {
    expression: string;
  };
}

export interface TableBlock extends BlockBase {
  type: 'table';
  table: {
    table_width: number;
    has_column_header: boolean;
    has_row_header: boolean;
  };
}

export interface TableRowBlock extends BlockBase {
  type: 'table_row';
  table_row: {
    cells: RichText[][];
  };
}

export interface ColumnListBlock extends BlockBase {
  type: 'column_list';
  column_list: Record<string, never>;
}

export interface ColumnBlock extends BlockBase {
  type: 'column';
  column: Record<string, never>;
}

export interface SyncedBlock extends BlockBase {
  type: 'synced_block';
  synced_block: {
    synced_from: { type: 'block_id'; block_id: string } | null;
  };
}

export interface TemplateBlock extends BlockBase {
  type: 'template';
  template: {
    rich_text: RichText[];
  };
}

export interface BreadcrumbBlock extends BlockBase {
  type: 'breadcrumb';
  breadcrumb: Record<string, never>;
}

export type NotionBlock =
  | ParagraphBlock
  | Heading1Block
  | Heading2Block
  | Heading3Block
  | BulletedListItemBlock
  | NumberedListItemBlock
  | ToDoBlock
  | ToggleBlock
  | CodeBlock
  | QuoteBlock
  | CalloutBlock
  | DividerBlock
  | TableOfContentsBlock
  | ChildPageBlock
  | ChildDatabaseBlock
  | ImageBlock
  | VideoBlock
  | FileBlock
  | PdfBlock
  | BookmarkBlock
  | EmbedBlock
  | LinkPreviewBlock
  | EquationBlock
  | TableBlock
  | TableRowBlock
  | ColumnListBlock
  | ColumnBlock
  | SyncedBlock
  | TemplateBlock
  | BreadcrumbBlock;

// ============================================
// Comment Types
// ============================================

export interface NotionComment {
  object: 'comment';
  id: string;
  parent: { type: 'page_id'; page_id: string } | { type: 'block_id'; block_id: string };
  discussion_id: string;
  created_time: string;
  created_by: NotionUser;
  rich_text: RichText[];
}

// ============================================
// Search Types
// ============================================

export interface SearchOptions {
  query?: string;
  filter?: {
    value: 'page' | 'database';
    property: 'object';
  };
  sort?: {
    direction: 'ascending' | 'descending';
    timestamp: 'last_edited_time';
  };
  start_cursor?: string;
  page_size?: number;
}

export type SearchResult = NotionPage | NotionDatabase;

// ============================================
// Database Query Types
// ============================================

export interface DatabaseQueryFilter {
  property?: string;
  [key: string]: unknown;
}

export interface DatabaseQuerySort {
  property?: string;
  timestamp?: 'created_time' | 'last_edited_time';
  direction: 'ascending' | 'descending';
}

export interface DatabaseQueryOptions {
  filter?: DatabaseQueryFilter;
  sorts?: DatabaseQuerySort[];
  start_cursor?: string;
  page_size?: number;
}

// ============================================
// Create/Update Types
// ============================================

export interface CreatePageOptions {
  parent: { database_id: string } | { page_id: string };
  properties: Record<string, unknown>;
  children?: unknown[];
  icon?: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } };
  cover?: { type: 'external'; external: { url: string } };
}

export interface UpdatePageOptions {
  properties?: Record<string, unknown>;
  archived?: boolean;
  icon?: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } } | null;
  cover?: { type: 'external'; external: { url: string } } | null;
}

export interface CreateDatabaseOptions {
  parent: { page_id: string };
  title: RichText[];
  properties: Record<string, unknown>;
  icon?: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } };
  cover?: { type: 'external'; external: { url: string } };
  is_inline?: boolean;
}

export interface UpdateDatabaseOptions {
  title?: RichText[];
  description?: RichText[];
  properties?: Record<string, unknown>;
  archived?: boolean;
  icon?: { type: 'emoji'; emoji: string } | { type: 'external'; external: { url: string } } | null;
  cover?: { type: 'external'; external: { url: string } } | null;
  is_inline?: boolean;
}

export interface CreateBlockOptions {
  type: string;
  [key: string]: unknown;
}

export interface UpdateBlockOptions {
  [key: string]: unknown;
  archived?: boolean;
}

export interface CreateCommentOptions {
  parent: { page_id: string };
  rich_text: Array<{
    type: 'text';
    text: { content: string; link?: { url: string } | null };
  }>;
  discussion_id?: string;
}

// ============================================
// API Error Types
// ============================================

export interface NotionError {
  object: 'error';
  status: number;
  code: string;
  message: string;
}

export class NotionApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string = 'unknown') {
    super(message);
    this.name = 'NotionApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
