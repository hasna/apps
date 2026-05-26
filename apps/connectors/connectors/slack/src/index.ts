// Main library exports
export { Slack, SlackClient, ChannelsApi, MessagesApi, UsersApi } from './api';

// Type exports
export type {
  SlackConfig,
  SlackUser,
  SlackUserProfile,
  SlackChannel,
  SlackMessage,
  SlackBlock,
  SlackAttachment,
  SlackApiResponse,
  ChatPostMessageOptions,
  ConversationsListOptions,
  ConversationsHistoryOptions,
  OAuth2Tokens,
  OutputFormat,
} from './types';

export { SlackApiError } from './types';
