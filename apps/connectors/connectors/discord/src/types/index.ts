// Discord API Types

export type OutputFormat = 'json' | 'table' | 'pretty';

// Configuration
export interface DiscordConfig {
  botToken?: string;
  bearerToken?: string;
  applicationId?: string;
  baseUrl?: string;
}

export interface CliConfig {
  botToken?: string;
  applicationId?: string;
  defaultGuildId?: string;
}

// API Error
export class DiscordApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly statusCode?: number,
    public readonly errors?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

// Snowflake type (Discord IDs)
export type Snowflake = string;

// User types
export interface DiscordUser {
  id: Snowflake;
  username: string;
  discriminator: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  banner?: string | null;
  accent_color?: number | null;
  locale?: string;
  verified?: boolean;
  email?: string | null;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
}

export interface DiscordMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: Snowflake[];
  joined_at: string;
  premium_since?: string | null;
  deaf: boolean;
  mute: boolean;
  flags: number;
  pending?: boolean;
  permissions?: string;
  communication_disabled_until?: string | null;
}

// Guild types
export interface DiscordGuild {
  id: Snowflake;
  name: string;
  icon?: string | null;
  splash?: string | null;
  discovery_splash?: string | null;
  owner?: boolean;
  owner_id: Snowflake;
  permissions?: string;
  afk_channel_id?: Snowflake | null;
  afk_timeout: number;
  verification_level: number;
  default_message_notifications: number;
  explicit_content_filter: number;
  roles: DiscordRole[];
  emojis: DiscordEmoji[];
  features: string[];
  mfa_level: number;
  application_id?: Snowflake | null;
  system_channel_id?: Snowflake | null;
  system_channel_flags: number;
  rules_channel_id?: Snowflake | null;
  max_members?: number;
  vanity_url_code?: string | null;
  description?: string | null;
  banner?: string | null;
  premium_tier: number;
  premium_subscription_count?: number;
  preferred_locale: string;
  public_updates_channel_id?: Snowflake | null;
  nsfw_level: number;
  premium_progress_bar_enabled: boolean;
}

export interface PartialGuild {
  id: Snowflake;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
  features: string[];
}

// Role types
export interface DiscordRole {
  id: Snowflake;
  name: string;
  color: number;
  hoist: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
  flags: number;
}

// Channel types
export enum ChannelType {
  GUILD_TEXT = 0,
  DM = 1,
  GUILD_VOICE = 2,
  GROUP_DM = 3,
  GUILD_CATEGORY = 4,
  GUILD_ANNOUNCEMENT = 5,
  ANNOUNCEMENT_THREAD = 10,
  PUBLIC_THREAD = 11,
  PRIVATE_THREAD = 12,
  GUILD_STAGE_VOICE = 13,
  GUILD_DIRECTORY = 14,
  GUILD_FORUM = 15,
  GUILD_MEDIA = 16,
}

export interface DiscordChannel {
  id: Snowflake;
  type: ChannelType;
  guild_id?: Snowflake;
  position?: number;
  permission_overwrites?: PermissionOverwrite[];
  name?: string | null;
  topic?: string | null;
  nsfw?: boolean;
  last_message_id?: Snowflake | null;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  recipients?: DiscordUser[];
  icon?: string | null;
  owner_id?: Snowflake;
  application_id?: Snowflake;
  parent_id?: Snowflake | null;
  last_pin_timestamp?: string | null;
  rtc_region?: string | null;
  video_quality_mode?: number;
  message_count?: number;
  member_count?: number;
  default_auto_archive_duration?: number;
  permissions?: string;
  flags?: number;
}

export interface PermissionOverwrite {
  id: Snowflake;
  type: number; // 0 = role, 1 = member
  allow: string;
  deny: string;
}

// Message types
export interface DiscordMessage {
  id: Snowflake;
  channel_id: Snowflake;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: DiscordUser[];
  mention_roles: Snowflake[];
  attachments: Attachment[];
  embeds: Embed[];
  reactions?: Reaction[];
  pinned: boolean;
  webhook_id?: Snowflake;
  type: number;
  flags?: number;
  referenced_message?: DiscordMessage | null;
  thread?: DiscordChannel;
  components?: Component[];
}

export interface Attachment {
  id: Snowflake;
  filename: string;
  description?: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
  height?: number | null;
  width?: number | null;
  ephemeral?: boolean;
}

export interface Embed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: EmbedFooter;
  image?: EmbedImage;
  thumbnail?: EmbedThumbnail;
  author?: EmbedAuthor;
  fields?: EmbedField[];
}

export interface EmbedFooter {
  text: string;
  icon_url?: string;
}

export interface EmbedImage {
  url: string;
  height?: number;
  width?: number;
}

export interface EmbedThumbnail {
  url: string;
  height?: number;
  width?: number;
}

export interface EmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Reaction {
  count: number;
  me: boolean;
  emoji: PartialEmoji;
}

export interface PartialEmoji {
  id?: Snowflake | null;
  name?: string | null;
  animated?: boolean;
}

export interface Component {
  type: number;
  custom_id?: string;
  disabled?: boolean;
  style?: number;
  label?: string;
  emoji?: PartialEmoji;
  url?: string;
  options?: SelectOption[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  components?: Component[];
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: PartialEmoji;
  default?: boolean;
}

// Emoji types
export interface DiscordEmoji {
  id?: Snowflake | null;
  name?: string | null;
  roles?: Snowflake[];
  user?: DiscordUser;
  require_colons?: boolean;
  managed?: boolean;
  animated?: boolean;
  available?: boolean;
}

// Webhook types
export interface DiscordWebhook {
  id: Snowflake;
  type: number;
  guild_id?: Snowflake | null;
  channel_id?: Snowflake | null;
  user?: DiscordUser;
  name?: string | null;
  avatar?: string | null;
  token?: string;
  application_id?: Snowflake | null;
  url?: string;
}

// Invite types
export interface DiscordInvite {
  code: string;
  guild?: PartialGuild;
  channel?: Partial<DiscordChannel> | null;
  inviter?: DiscordUser;
  approximate_presence_count?: number;
  approximate_member_count?: number;
  expires_at?: string | null;
  uses?: number;
  max_uses?: number;
  max_age?: number;
  temporary?: boolean;
  created_at?: string;
}

// Voice types
export interface VoiceRegion {
  id: string;
  name: string;
  optimal: boolean;
  deprecated: boolean;
  custom: boolean;
}

// Ban types
export interface DiscordBan {
  reason?: string | null;
  user: DiscordUser;
}

// Audit Log types
export interface AuditLog {
  audit_log_entries: AuditLogEntry[];
  users: DiscordUser[];
  webhooks: DiscordWebhook[];
}

export interface AuditLogEntry {
  target_id?: string | null;
  user_id?: Snowflake | null;
  id: Snowflake;
  action_type: number;
  reason?: string;
}

// Application Command types
export interface ApplicationCommand {
  id: Snowflake;
  type?: number;
  application_id: Snowflake;
  guild_id?: Snowflake;
  name: string;
  description: string;
  options?: ApplicationCommandOption[];
  default_member_permissions?: string | null;
  dm_permission?: boolean;
  nsfw?: boolean;
  version: Snowflake;
}

export interface ApplicationCommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: ApplicationCommandOptionChoice[];
  options?: ApplicationCommandOption[];
  channel_types?: ChannelType[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  autocomplete?: boolean;
}

export interface ApplicationCommandOptionChoice {
  name: string;
  value: string | number;
}

// Gateway types
export interface GatewayInfo {
  url: string;
}

export interface GatewayBotInfo extends GatewayInfo {
  shards: number;
  session_start_limit: SessionStartLimit;
}

export interface SessionStartLimit {
  total: number;
  remaining: number;
  reset_after: number;
  max_concurrency: number;
}

// Request options
export interface ListOptions {
  limit?: number;
  before?: Snowflake;
  after?: Snowflake;
}

export interface GetMessagesOptions extends ListOptions {
  around?: Snowflake;
}

export interface CreateMessageOptions {
  content?: string;
  tts?: boolean;
  embeds?: Embed[];
  allowed_mentions?: AllowedMentions;
  message_reference?: MessageReference;
  components?: Component[];
  sticker_ids?: Snowflake[];
  attachments?: Partial<Attachment>[];
  flags?: number;
}

export interface AllowedMentions {
  parse?: ('roles' | 'users' | 'everyone')[];
  roles?: Snowflake[];
  users?: Snowflake[];
  replied_user?: boolean;
}

export interface MessageReference {
  message_id?: Snowflake;
  channel_id?: Snowflake;
  guild_id?: Snowflake;
  fail_if_not_exists?: boolean;
}

export interface EditMessageOptions {
  content?: string | null;
  embeds?: Embed[] | null;
  flags?: number | null;
  allowed_mentions?: AllowedMentions | null;
  components?: Component[] | null;
  attachments?: Partial<Attachment>[] | null;
}

export interface CreateGuildChannelOptions {
  name: string;
  type?: ChannelType;
  topic?: string;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  position?: number;
  permission_overwrites?: PermissionOverwrite[];
  parent_id?: Snowflake;
  nsfw?: boolean;
}

export interface ModifyChannelOptions {
  name?: string;
  type?: ChannelType;
  position?: number | null;
  topic?: string | null;
  nsfw?: boolean | null;
  rate_limit_per_user?: number | null;
  bitrate?: number | null;
  user_limit?: number | null;
  permission_overwrites?: PermissionOverwrite[] | null;
  parent_id?: Snowflake | null;
}

export interface CreateGuildRoleOptions {
  name?: string;
  permissions?: string;
  color?: number;
  hoist?: boolean;
  mentionable?: boolean;
}

export interface CreateWebhookOptions {
  name: string;
  avatar?: string | null;
}

export interface ExecuteWebhookOptions {
  content?: string;
  username?: string;
  avatar_url?: string;
  tts?: boolean;
  embeds?: Embed[];
  allowed_mentions?: AllowedMentions;
  components?: Component[];
  flags?: number;
  thread_name?: string;
}

export interface CreateInviteOptions {
  max_age?: number;
  max_uses?: number;
  temporary?: boolean;
  unique?: boolean;
}

export interface CreateBanOptions {
  delete_message_seconds?: number;
}

export interface ModifyGuildMemberOptions {
  nick?: string | null;
  roles?: Snowflake[] | null;
  mute?: boolean | null;
  deaf?: boolean | null;
  channel_id?: Snowflake | null;
  communication_disabled_until?: string | null;
}

export interface CreateApplicationCommandOptions {
  name: string;
  description?: string;
  options?: ApplicationCommandOption[];
  default_member_permissions?: string | null;
  dm_permission?: boolean;
  type?: number;
  nsfw?: boolean;
}
