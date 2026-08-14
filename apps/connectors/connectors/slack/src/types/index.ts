// Slack API Types

export type OutputFormat = 'json' | 'table' | 'pretty';

// Configuration
export interface SlackConfig {
  accessToken?: string;
  botToken?: string;
  teamId?: string;
  baseUrl?: string;
}

export interface CliConfig {
  botToken?: string;
  userToken?: string;
  teamId?: string;
  teamName?: string;
  defaultChannel?: string;
}

export interface OAuth2Tokens {
  accessToken: string;
  tokenType: string;
  scope: string;
  botUserId?: string;
  appId?: string;
  team?: {
    id: string;
    name: string;
  };
  authedUser?: {
    id: string;
    scope: string;
    accessToken: string;
    tokenType: string;
  };
  expiresAt?: number;
}

// API Error
export class SlackApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'SlackApiError';
  }
}

// User types
export interface SlackUser {
  id: string;
  team_id: string;
  name: string;
  deleted: boolean;
  real_name?: string;
  tz?: string;
  tz_label?: string;
  tz_offset?: number;
  profile: SlackUserProfile;
  is_admin?: boolean;
  is_owner?: boolean;
  is_primary_owner?: boolean;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  updated?: number;
}

export interface SlackUserProfile {
  title?: string;
  phone?: string;
  skype?: string;
  real_name?: string;
  real_name_normalized?: string;
  display_name?: string;
  display_name_normalized?: string;
  status_text?: string;
  status_emoji?: string;
  status_expiration?: number;
  avatar_hash?: string;
  email?: string;
  image_24?: string;
  image_32?: string;
  image_48?: string;
  image_72?: string;
  image_192?: string;
  image_512?: string;
  team?: string;
}

// Channel types
export interface SlackChannel {
  id: string;
  name: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  created?: number;
  is_archived?: boolean;
  is_general?: boolean;
  unlinked?: number;
  name_normalized?: string;
  is_shared?: boolean;
  is_org_shared?: boolean;
  is_pending_ext_shared?: boolean;
  pending_shared?: string[];
  context_team_id?: string;
  updated?: number;
  creator?: string;
  is_member?: boolean;
  num_members?: number;
  topic?: {
    value: string;
    creator: string;
    last_set: number;
  };
  purpose?: {
    value: string;
    creator: string;
    last_set: number;
  };
}

// Message types
export interface SlackMessage {
  type: string;
  subtype?: string;
  ts: string;
  user?: string;
  text: string;
  bot_id?: string;
  app_id?: string;
  team?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  edited?: {
    user: string;
    ts: string;
  };
  reply_count?: number;
  reply_users_count?: number;
  latest_reply?: string;
  reply_users?: string[];
  is_locked?: boolean;
  subscribed?: boolean;
  thread_ts?: string;
  parent_user_id?: string;
}

export interface SlackBlock {
  type: string;
  block_id?: string;
  elements?: unknown[];
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
    verbatim?: boolean;
  };
}

export interface SlackAttachment {
  fallback?: string;
  color?: string;
  pretext?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: {
    title: string;
    value: string;
    short?: boolean;
  }[];
  image_url?: string;
  thumb_url?: string;
  footer?: string;
  footer_icon?: string;
  ts?: number;
}

// API Response types
export interface SlackApiResponse<T = unknown> {
  ok: boolean;
  error?: string;
  warning?: string;
  response_metadata?: {
    next_cursor?: string;
    scopes?: string[];
    acceptedScopes?: string[];
  };
  [key: string]: unknown;
}

export interface UsersListResponse extends SlackApiResponse {
  members: SlackUser[];
  cache_ts: number;
}

export interface ConversationsListResponse extends SlackApiResponse {
  channels: SlackChannel[];
}

export interface ConversationsHistoryResponse extends SlackApiResponse {
  messages: SlackMessage[];
  has_more: boolean;
  pin_count?: number;
}

export interface ChatPostMessageResponse extends SlackApiResponse {
  channel: string;
  ts: string;
  message: SlackMessage;
}

export interface AuthTestResponse extends SlackApiResponse {
  url: string;
  team: string;
  user: string;
  team_id: string;
  user_id: string;
  bot_id?: string;
  is_enterprise_install?: boolean;
}

// Request options
export interface ListOptions {
  limit?: number;
  cursor?: string;
}

export interface ConversationsListOptions extends ListOptions {
  types?: string; // 'public_channel,private_channel,mpim,im'
  exclude_archived?: boolean;
  team_id?: string;
}

export interface ConversationsHistoryOptions extends ListOptions {
  channel: string;
  oldest?: string;
  latest?: string;
  inclusive?: boolean;
}

export interface ChatPostMessageOptions {
  channel: string;
  text?: string;
  blocks?: SlackBlock[];
  attachments?: SlackAttachment[];
  thread_ts?: string;
  reply_broadcast?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  mrkdwn?: boolean;
}
