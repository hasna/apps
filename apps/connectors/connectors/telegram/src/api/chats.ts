import type { TelegramClient } from './client';
import type { TelegramChat, TelegramChatMember, TelegramChatPermissions, TelegramUser } from '../types';

export interface GetChatOptions {
  chatId: number | string;
}

export interface GetChatMemberOptions {
  chatId: number | string;
  userId: number;
}

export interface GetChatMemberCountOptions {
  chatId: number | string;
}

export interface GetChatAdministratorsOptions {
  chatId: number | string;
}

export interface LeaveChatOptions {
  chatId: number | string;
}

export interface SetChatTitleOptions {
  chatId: number | string;
  title: string;
}

export interface SetChatDescriptionOptions {
  chatId: number | string;
  description?: string;
}

export interface BanChatMemberOptions {
  chatId: number | string;
  userId: number;
  untilDate?: number;
  revokeMessages?: boolean;
}

export interface UnbanChatMemberOptions {
  chatId: number | string;
  userId: number;
  onlyIfBanned?: boolean;
}

export interface ExportChatInviteLinkOptions {
  chatId: number | string;
}

export interface PinChatMessageOptions {
  chatId: number | string;
  messageId: number;
  disableNotification?: boolean;
}

export interface UnpinChatMessageOptions {
  chatId: number | string;
  messageId?: number;
}

export interface UnpinAllChatMessagesOptions {
  chatId: number | string;
}

export interface RestrictChatMemberOptions {
  chatId: number | string;
  userId: number;
  permissions: TelegramChatPermissions;
  useIndependentChatPermissions?: boolean;
  untilDate?: number;
}

export interface PromoteChatMemberOptions {
  chatId: number | string;
  userId: number;
  isAnonymous?: boolean;
  canManageChat?: boolean;
  canDeleteMessages?: boolean;
  canManageVideoChats?: boolean;
  canRestrictMembers?: boolean;
  canPromoteMembers?: boolean;
  canChangeInfo?: boolean;
  canInviteUsers?: boolean;
  canPostMessages?: boolean;
  canEditMessages?: boolean;
  canPinMessages?: boolean;
  canManageTopics?: boolean;
}

/**
 * Telegram Chats API
 */
export class ChatsApi {
  constructor(private readonly client: TelegramClient) {}

  /**
   * Get chat information
   */
  async getChat(options: GetChatOptions): Promise<TelegramChat> {
    return this.client.request<TelegramChat>('getChat', {
      params: {
        chat_id: options.chatId,
      },
    });
  }

  /**
   * Get a chat member
   */
  async getChatMember(options: GetChatMemberOptions): Promise<TelegramChatMember> {
    return this.client.request<TelegramChatMember>('getChatMember', {
      params: {
        chat_id: options.chatId,
        user_id: options.userId,
      },
    });
  }

  /**
   * Get the number of members in a chat
   */
  async getChatMemberCount(options: GetChatMemberCountOptions): Promise<number> {
    return this.client.request<number>('getChatMemberCount', {
      params: {
        chat_id: options.chatId,
      },
    });
  }

  /**
   * Get chat administrators
   */
  async getChatAdministrators(options: GetChatAdministratorsOptions): Promise<TelegramChatMember[]> {
    return this.client.request<TelegramChatMember[]>('getChatAdministrators', {
      params: {
        chat_id: options.chatId,
      },
    });
  }

  /**
   * Leave a chat
   */
  async leaveChat(options: LeaveChatOptions): Promise<boolean> {
    return this.client.request<boolean>('leaveChat', {
      params: {
        chat_id: options.chatId,
      },
    });
  }

  /**
   * Set chat title (for groups and channels)
   */
  async setChatTitle(options: SetChatTitleOptions): Promise<boolean> {
    return this.client.request<boolean>('setChatTitle', {
      params: {
        chat_id: options.chatId,
        title: options.title,
      },
    });
  }

  /**
   * Set chat description
   */
  async setChatDescription(options: SetChatDescriptionOptions): Promise<boolean> {
    return this.client.request<boolean>('setChatDescription', {
      params: {
        chat_id: options.chatId,
        description: options.description,
      },
    });
  }

  /**
   * Ban a user from a chat
   */
  async banChatMember(options: BanChatMemberOptions): Promise<boolean> {
    return this.client.request<boolean>('banChatMember', {
      params: {
        chat_id: options.chatId,
        user_id: options.userId,
        until_date: options.untilDate,
        revoke_messages: options.revokeMessages,
      },
    });
  }

  /**
   * Unban a user from a chat
   */
  async unbanChatMember(options: UnbanChatMemberOptions): Promise<boolean> {
    return this.client.request<boolean>('unbanChatMember', {
      params: {
        chat_id: options.chatId,
        user_id: options.userId,
        only_if_banned: options.onlyIfBanned,
      },
    });
  }

  /**
   * Export chat invite link
   */
  async exportChatInviteLink(options: ExportChatInviteLinkOptions): Promise<string> {
    return this.client.request<string>('exportChatInviteLink', {
      params: {
        chat_id: options.chatId,
      },
    });
  }

  /**
   * Pin a message in a chat
   */
  async pinChatMessage(options: PinChatMessageOptions): Promise<boolean> {
    return this.client.request<boolean>('pinChatMessage', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
        disable_notification: options.disableNotification,
      },
    });
  }

  /**
   * Unpin a message in a chat
   */
  async unpinChatMessage(options: UnpinChatMessageOptions): Promise<boolean> {
    return this.client.request<boolean>('unpinChatMessage', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
      },
    });
  }

  /**
   * Unpin all messages in a chat
   */
  async unpinAllChatMessages(options: UnpinAllChatMessagesOptions): Promise<boolean> {
    return this.client.request<boolean>('unpinAllChatMessages', {
      params: {
        chat_id: options.chatId,
      },
    });
  }

  /**
   * Restrict a chat member
   */
  async restrictChatMember(options: RestrictChatMemberOptions): Promise<boolean> {
    return this.client.request<boolean>('restrictChatMember', {
      body: {
        chat_id: options.chatId,
        user_id: options.userId,
        permissions: options.permissions,
        use_independent_chat_permissions: options.useIndependentChatPermissions,
        until_date: options.untilDate,
      },
    });
  }

  /**
   * Promote a chat member
   */
  async promoteChatMember(options: PromoteChatMemberOptions): Promise<boolean> {
    return this.client.request<boolean>('promoteChatMember', {
      params: {
        chat_id: options.chatId,
        user_id: options.userId,
        is_anonymous: options.isAnonymous,
        can_manage_chat: options.canManageChat,
        can_delete_messages: options.canDeleteMessages,
        can_manage_video_chats: options.canManageVideoChats,
        can_restrict_members: options.canRestrictMembers,
        can_promote_members: options.canPromoteMembers,
        can_change_info: options.canChangeInfo,
        can_invite_users: options.canInviteUsers,
        can_post_messages: options.canPostMessages,
        can_edit_messages: options.canEditMessages,
        can_pin_messages: options.canPinMessages,
        can_manage_topics: options.canManageTopics,
      },
    });
  }
}
