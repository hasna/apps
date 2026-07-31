// Telegram Connector Types

// ============================================
// Configuration
// ============================================

export interface TelegramConfig {
  botToken: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

// ============================================
// Webhook Types
// ============================================

export interface TelegramWebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

// ============================================
// User Types
// ============================================

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  added_to_attachment_menu?: boolean;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

// ============================================
// Chat Types
// ============================================

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
  photo?: TelegramChatPhoto;
  active_usernames?: string[];
  bio?: string;
  has_private_forwards?: boolean;
  has_restricted_voice_and_video_messages?: boolean;
  join_to_send_messages?: boolean;
  join_by_request?: boolean;
  description?: string;
  invite_link?: string;
  pinned_message?: TelegramMessage;
  permissions?: TelegramChatPermissions;
  slow_mode_delay?: number;
  message_auto_delete_time?: number;
  has_aggressive_anti_spam_enabled?: boolean;
  has_hidden_members?: boolean;
  has_protected_content?: boolean;
  sticker_set_name?: string;
  can_set_sticker_set?: boolean;
  linked_chat_id?: number;
  location?: TelegramChatLocation;
}

export interface TelegramChatPhoto {
  small_file_id: string;
  small_file_unique_id: string;
  big_file_id: string;
  big_file_unique_id: string;
}

export interface TelegramChatPermissions {
  can_send_messages?: boolean;
  can_send_audios?: boolean;
  can_send_documents?: boolean;
  can_send_photos?: boolean;
  can_send_videos?: boolean;
  can_send_video_notes?: boolean;
  can_send_voice_notes?: boolean;
  can_send_polls?: boolean;
  can_send_other_messages?: boolean;
  can_add_web_page_previews?: boolean;
  can_change_info?: boolean;
  can_invite_users?: boolean;
  can_pin_messages?: boolean;
  can_manage_topics?: boolean;
}

export interface TelegramChatLocation {
  location: TelegramLocation;
  address: string;
}

export interface TelegramLocation {
  longitude: number;
  latitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
  proximity_alert_radius?: number;
}

export interface TelegramChatMember {
  status: 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';
  user: TelegramUser;
  is_anonymous?: boolean;
  custom_title?: string;
}

// ============================================
// Message Types
// ============================================

export interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  date: number;
  chat: TelegramChat;
  forward_from?: TelegramUser;
  forward_from_chat?: TelegramChat;
  forward_from_message_id?: number;
  forward_signature?: string;
  forward_sender_name?: string;
  forward_date?: number;
  is_topic_message?: boolean;
  is_automatic_forward?: boolean;
  reply_to_message?: TelegramMessage;
  via_bot?: TelegramUser;
  edit_date?: number;
  has_protected_content?: boolean;
  media_group_id?: string;
  author_signature?: string;
  text?: string;
  entities?: TelegramMessageEntity[];
  caption?: string;
  caption_entities?: TelegramMessageEntity[];
  animation?: TelegramAnimation;
  audio?: TelegramAudio;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  voice?: TelegramVoice;
  video_note?: TelegramVideoNote;
  contact?: TelegramContact;
  location?: TelegramLocation;
  venue?: TelegramVenue;
  poll?: TelegramPoll;
  dice?: TelegramDice;
  new_chat_members?: TelegramUser[];
  left_chat_member?: TelegramUser;
  new_chat_title?: string;
  new_chat_photo?: TelegramPhotoSize[];
  delete_chat_photo?: boolean;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  channel_chat_created?: boolean;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  pinned_message?: TelegramMessage;
  reply_markup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup | TelegramReplyKeyboardRemove;
}

export interface TelegramMessageEntity {
  type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'text_mention' | 'custom_emoji';
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
  language?: string;
  custom_emoji_id?: string;
}

// ============================================
// Media Types
// ============================================

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramAnimation {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  thumbnail?: TelegramPhotoSize;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  thumbnail?: TelegramPhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideoNote {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  file_size?: number;
}

export interface TelegramContact {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
  vcard?: string;
}

export interface TelegramVenue {
  location: TelegramLocation;
  title: string;
  address: string;
  foursquare_id?: string;
  foursquare_type?: string;
  google_place_id?: string;
  google_place_type?: string;
}

export interface TelegramPoll {
  id: string;
  question: string;
  options: TelegramPollOption[];
  total_voter_count: number;
  is_closed: boolean;
  is_anonymous: boolean;
  type: 'regular' | 'quiz';
  allows_multiple_answers: boolean;
  correct_option_id?: number;
  explanation?: string;
  explanation_entities?: TelegramMessageEntity[];
  open_period?: number;
  close_date?: number;
}

export interface TelegramPollOption {
  text: string;
  voter_count: number;
}

export interface TelegramDice {
  emoji: string;
  value: number;
}

// ============================================
// Keyboard Types
// ============================================

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  switch_inline_query?: string;
  switch_inline_query_current_chat?: string;
  pay?: boolean;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramKeyboardButton[][];
  is_persistent?: boolean;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
  selective?: boolean;
}

export interface TelegramKeyboardButton {
  text: string;
  request_user?: TelegramKeyboardButtonRequestUser;
  request_chat?: TelegramKeyboardButtonRequestChat;
  request_contact?: boolean;
  request_location?: boolean;
  request_poll?: TelegramKeyboardButtonPollType;
}

export interface TelegramKeyboardButtonRequestUser {
  request_id: number;
  user_is_bot?: boolean;
  user_is_premium?: boolean;
}

export interface TelegramKeyboardButtonRequestChat {
  request_id: number;
  chat_is_channel: boolean;
  chat_is_forum?: boolean;
  chat_has_username?: boolean;
  chat_is_created?: boolean;
  user_administrator_rights?: TelegramChatPermissions;
  bot_administrator_rights?: TelegramChatPermissions;
  bot_is_member?: boolean;
}

export interface TelegramKeyboardButtonPollType {
  type?: 'quiz' | 'regular';
}

export interface TelegramReplyKeyboardRemove {
  remove_keyboard: true;
  selective?: boolean;
}

// ============================================
// Update Types
// ============================================

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  inline_query?: TelegramInlineQuery;
  chosen_inline_result?: TelegramChosenInlineResult;
  callback_query?: TelegramCallbackQuery;
  shipping_query?: TelegramShippingQuery;
  pre_checkout_query?: TelegramPreCheckoutQuery;
  poll?: TelegramPoll;
  poll_answer?: TelegramPollAnswer;
  my_chat_member?: TelegramChatMemberUpdated;
  chat_member?: TelegramChatMemberUpdated;
  chat_join_request?: TelegramChatJoinRequest;
}

export interface TelegramInlineQuery {
  id: string;
  from: TelegramUser;
  query: string;
  offset: string;
  chat_type?: 'sender' | 'private' | 'group' | 'supergroup' | 'channel';
  location?: TelegramLocation;
}

export interface TelegramChosenInlineResult {
  result_id: string;
  from: TelegramUser;
  location?: TelegramLocation;
  inline_message_id?: string;
  query: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
  game_short_name?: string;
}

export interface TelegramShippingQuery {
  id: string;
  from: TelegramUser;
  invoice_payload: string;
  shipping_address: TelegramShippingAddress;
}

export interface TelegramShippingAddress {
  country_code: string;
  state: string;
  city: string;
  street_line1: string;
  street_line2: string;
  post_code: string;
}

export interface TelegramPreCheckoutQuery {
  id: string;
  from: TelegramUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
  shipping_option_id?: string;
  order_info?: TelegramOrderInfo;
}

export interface TelegramOrderInfo {
  name?: string;
  phone_number?: string;
  email?: string;
  shipping_address?: TelegramShippingAddress;
}

export interface TelegramPollAnswer {
  poll_id: string;
  user: TelegramUser;
  option_ids: number[];
}

export interface TelegramChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: TelegramChatMember;
  new_chat_member: TelegramChatMember;
  invite_link?: TelegramChatInviteLink;
}

export interface TelegramChatInviteLink {
  invite_link: string;
  creator: TelegramUser;
  creates_join_request: boolean;
  is_primary: boolean;
  is_revoked: boolean;
  name?: string;
  expire_date?: number;
  member_limit?: number;
  pending_join_request_count?: number;
}

export interface TelegramChatJoinRequest {
  chat: TelegramChat;
  from: TelegramUser;
  user_chat_id: number;
  date: number;
  bio?: string;
  invite_link?: TelegramChatInviteLink;
}

// ============================================
// Inline Query Result Types
// ============================================

export type TelegramInlineQueryResult =
  | TelegramInlineQueryResultArticle
  | TelegramInlineQueryResultPhoto
  | TelegramInlineQueryResultDocument;

export interface TelegramInlineQueryResultArticle {
  type: 'article';
  id: string;
  title: string;
  input_message_content: TelegramInputMessageContent;
  reply_markup?: TelegramInlineKeyboardMarkup;
  url?: string;
  hide_url?: boolean;
  description?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

export interface TelegramInlineQueryResultPhoto {
  type: 'photo';
  id: string;
  photo_url: string;
  thumbnail_url: string;
  photo_width?: number;
  photo_height?: number;
  title?: string;
  description?: string;
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  caption_entities?: TelegramMessageEntity[];
  reply_markup?: TelegramInlineKeyboardMarkup;
  input_message_content?: TelegramInputMessageContent;
}

export interface TelegramInlineQueryResultDocument {
  type: 'document';
  id: string;
  title: string;
  document_url: string;
  mime_type: string;
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  caption_entities?: TelegramMessageEntity[];
  description?: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
  input_message_content?: TelegramInputMessageContent;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}

export type TelegramInputMessageContent =
  | TelegramInputTextMessageContent
  | TelegramInputLocationMessageContent
  | TelegramInputVenueMessageContent
  | TelegramInputContactMessageContent;

export interface TelegramInputTextMessageContent {
  message_text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  entities?: TelegramMessageEntity[];
  disable_web_page_preview?: boolean;
}

export interface TelegramInputLocationMessageContent {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
  proximity_alert_radius?: number;
}

export interface TelegramInputVenueMessageContent {
  latitude: number;
  longitude: number;
  title: string;
  address: string;
  foursquare_id?: string;
  foursquare_type?: string;
  google_place_id?: string;
  google_place_type?: string;
}

export interface TelegramInputContactMessageContent {
  phone_number: string;
  first_name: string;
  last_name?: string;
  vcard?: string;
}

// ============================================
// File Types
// ============================================

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

// ============================================
// API Response Types
// ============================================

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    migrate_to_chat_id?: number;
    retry_after?: number;
  };
}

// ============================================
// API Error Types
// ============================================

export class TelegramApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: number;
  public readonly description: string;

  constructor(message: string, statusCode: number, errorCode?: number) {
    super(message);
    this.name = 'TelegramApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.description = message;
  }
}
