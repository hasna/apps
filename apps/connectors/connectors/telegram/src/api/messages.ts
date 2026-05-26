import type { TelegramClient } from './client';
import type {
  TelegramMessage,
  TelegramPoll,
  TelegramInlineKeyboardMarkup,
  TelegramReplyKeyboardMarkup,
  TelegramReplyKeyboardRemove,
} from '../types';

export interface SendMessageOptions {
  chatId: number | string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup | TelegramReplyKeyboardRemove;
}

export interface SendPhotoOptions {
  chatId: number | string;
  photo: string | Uint8Array;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup | TelegramReplyKeyboardRemove;
}

export interface SendDocumentOptions {
  chatId: number | string;
  document: string | Uint8Array;
  fileName?: string;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup | TelegramReplyKeyboardRemove;
}

export interface ForwardMessageOptions {
  chatId: number | string;
  fromChatId: number | string;
  messageId: number;
  disableNotification?: boolean;
  protectContent?: boolean;
}

export interface EditMessageTextOptions {
  chatId?: number | string;
  messageId?: number;
  inlineMessageId?: string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableWebPagePreview?: boolean;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface DeleteMessageOptions {
  chatId: number | string;
  messageId: number;
}

export interface DeleteMessagesOptions {
  chatId: number | string;
  messageIds: number[];
}

export interface CopyMessageOptions {
  chatId: number | string;
  fromChatId: number | string;
  messageId: number;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendLocationOptions {
  chatId: number | string;
  latitude: number;
  longitude: number;
  horizontalAccuracy?: number;
  livePeriod?: number;
  heading?: number;
  proximityAlertRadius?: number;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendPollOptions {
  chatId: number | string;
  question: string;
  options: string[];
  isAnonymous?: boolean;
  type?: 'regular' | 'quiz';
  allowsMultipleAnswers?: boolean;
  correctOptionId?: number;
  explanation?: string;
  explanationParseMode?: string;
  openPeriod?: number;
  closeDate?: number;
  isClosed?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendDiceOptions {
  chatId: number | string;
  emoji?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendAudioOptions {
  chatId: number | string;
  audio: string | Uint8Array;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  duration?: number;
  performer?: string;
  title?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendVideoOptions {
  chatId: number | string;
  video: string | Uint8Array;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  duration?: number;
  width?: number;
  height?: number;
  hasSpoiler?: boolean;
  supportsStreaming?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendAnimationOptions {
  chatId: number | string;
  animation: string | Uint8Array;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  duration?: number;
  width?: number;
  height?: number;
  hasSpoiler?: boolean;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendVoiceOptions {
  chatId: number | string;
  voice: string | Uint8Array;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  duration?: number;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendVideoNoteOptions {
  chatId: number | string;
  videoNote: string | Uint8Array;
  duration?: number;
  length?: number;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendVenueOptions {
  chatId: number | string;
  latitude: number;
  longitude: number;
  title: string;
  address: string;
  foursquareId?: string;
  foursquareType?: string;
  googlePlaceId?: string;
  googlePlaceType?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendContactOptions {
  chatId: number | string;
  phoneNumber: string;
  firstName: string;
  lastName?: string;
  vcard?: string;
  disableNotification?: boolean;
  protectContent?: boolean;
  replyToMessageId?: number;
}

export interface SendChatActionOptions {
  chatId: number | string;
  action: string;
}

export interface EditMessageCaptionOptions {
  chatId?: number | string;
  messageId?: number;
  inlineMessageId?: string;
  caption?: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface EditMessageMediaOptions {
  chatId?: number | string;
  messageId?: number;
  inlineMessageId?: string;
  media: object;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface EditMessageReplyMarkupOptions {
  chatId?: number | string;
  messageId?: number;
  inlineMessageId?: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

export interface StopPollOptions {
  chatId: number | string;
  messageId: number;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}

/**
 * Telegram Messages API
 */
export class MessagesApi {
  constructor(private readonly client: TelegramClient) {}

  /**
   * Send a text message
   */
  async sendMessage(options: SendMessageOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('sendMessage', {
      params: {
        chat_id: options.chatId,
        text: options.text,
        parse_mode: options.parseMode,
        disable_web_page_preview: options.disableWebPagePreview,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }

  /**
   * Send a photo
   */
  async sendPhoto(options: SendPhotoOptions): Promise<TelegramMessage> {
    if (options.photo instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendPhoto',
        'photo',
        options.photo,
        'photo.jpg',
        {
          chat_id: options.chatId,
          caption: options.caption,
          parse_mode: options.parseMode,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
          reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendPhoto', {
      params: {
        chat_id: options.chatId,
        photo: options.photo,
        caption: options.caption,
        parse_mode: options.parseMode,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }

  /**
   * Send a document
   */
  async sendDocument(options: SendDocumentOptions): Promise<TelegramMessage> {
    if (options.document instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendDocument',
        'document',
        options.document,
        options.fileName || 'document',
        {
          chat_id: options.chatId,
          caption: options.caption,
          parse_mode: options.parseMode,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
          reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendDocument', {
      params: {
        chat_id: options.chatId,
        document: options.document,
        caption: options.caption,
        parse_mode: options.parseMode,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }

  /**
   * Forward a message
   */
  async forwardMessage(options: ForwardMessageOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('forwardMessage', {
      params: {
        chat_id: options.chatId,
        from_chat_id: options.fromChatId,
        message_id: options.messageId,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
      },
    });
  }

  /**
   * Edit a message text
   */
  async editMessageText(options: EditMessageTextOptions): Promise<TelegramMessage | boolean> {
    return this.client.request<TelegramMessage | boolean>('editMessageText', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
        inline_message_id: options.inlineMessageId,
        text: options.text,
        parse_mode: options.parseMode,
        disable_web_page_preview: options.disableWebPagePreview,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }

  /**
   * Delete a message
   */
  async deleteMessage(options: DeleteMessageOptions): Promise<boolean> {
    return this.client.request<boolean>('deleteMessage', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
      },
    });
  }

  /**
   * Delete multiple messages
   */
  async deleteMessages(options: DeleteMessagesOptions): Promise<boolean> {
    return this.client.request<boolean>('deleteMessages', {
      body: {
        chat_id: options.chatId,
        message_ids: options.messageIds,
      },
    });
  }

  /**
   * Copy a message
   */
  async copyMessage(options: CopyMessageOptions): Promise<{ message_id: number }> {
    return this.client.request<{ message_id: number }>('copyMessage', {
      params: {
        chat_id: options.chatId,
        from_chat_id: options.fromChatId,
        message_id: options.messageId,
        caption: options.caption,
        parse_mode: options.parseMode,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a location
   */
  async sendLocation(options: SendLocationOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('sendLocation', {
      params: {
        chat_id: options.chatId,
        latitude: options.latitude,
        longitude: options.longitude,
        horizontal_accuracy: options.horizontalAccuracy,
        live_period: options.livePeriod,
        heading: options.heading,
        proximity_alert_radius: options.proximityAlertRadius,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a poll
   */
  async sendPoll(options: SendPollOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('sendPoll', {
      body: {
        chat_id: options.chatId,
        question: options.question,
        options: options.options,
        is_anonymous: options.isAnonymous,
        type: options.type,
        allows_multiple_answers: options.allowsMultipleAnswers,
        correct_option_id: options.correctOptionId,
        explanation: options.explanation,
        explanation_parse_mode: options.explanationParseMode,
        open_period: options.openPeriod,
        close_date: options.closeDate,
        is_closed: options.isClosed,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a dice
   */
  async sendDice(options: SendDiceOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('sendDice', {
      params: {
        chat_id: options.chatId,
        emoji: options.emoji,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send an audio file
   */
  async sendAudio(options: SendAudioOptions): Promise<TelegramMessage> {
    if (options.audio instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendAudio',
        'audio',
        options.audio,
        'audio.mp3',
        {
          chat_id: options.chatId,
          caption: options.caption,
          parse_mode: options.parseMode,
          duration: options.duration,
          performer: options.performer,
          title: options.title,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendAudio', {
      params: {
        chat_id: options.chatId,
        audio: options.audio,
        caption: options.caption,
        parse_mode: options.parseMode,
        duration: options.duration,
        performer: options.performer,
        title: options.title,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a video
   */
  async sendVideo(options: SendVideoOptions): Promise<TelegramMessage> {
    if (options.video instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendVideo',
        'video',
        options.video,
        'video.mp4',
        {
          chat_id: options.chatId,
          caption: options.caption,
          parse_mode: options.parseMode,
          duration: options.duration,
          width: options.width,
          height: options.height,
          has_spoiler: options.hasSpoiler,
          supports_streaming: options.supportsStreaming,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendVideo', {
      params: {
        chat_id: options.chatId,
        video: options.video,
        caption: options.caption,
        parse_mode: options.parseMode,
        duration: options.duration,
        width: options.width,
        height: options.height,
        has_spoiler: options.hasSpoiler,
        supports_streaming: options.supportsStreaming,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send an animation (GIF)
   */
  async sendAnimation(options: SendAnimationOptions): Promise<TelegramMessage> {
    if (options.animation instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendAnimation',
        'animation',
        options.animation,
        'animation.gif',
        {
          chat_id: options.chatId,
          caption: options.caption,
          parse_mode: options.parseMode,
          duration: options.duration,
          width: options.width,
          height: options.height,
          has_spoiler: options.hasSpoiler,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendAnimation', {
      params: {
        chat_id: options.chatId,
        animation: options.animation,
        caption: options.caption,
        parse_mode: options.parseMode,
        duration: options.duration,
        width: options.width,
        height: options.height,
        has_spoiler: options.hasSpoiler,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a voice message
   */
  async sendVoice(options: SendVoiceOptions): Promise<TelegramMessage> {
    if (options.voice instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendVoice',
        'voice',
        options.voice,
        'voice.ogg',
        {
          chat_id: options.chatId,
          caption: options.caption,
          parse_mode: options.parseMode,
          duration: options.duration,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendVoice', {
      params: {
        chat_id: options.chatId,
        voice: options.voice,
        caption: options.caption,
        parse_mode: options.parseMode,
        duration: options.duration,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a video note
   */
  async sendVideoNote(options: SendVideoNoteOptions): Promise<TelegramMessage> {
    if (options.videoNote instanceof Uint8Array) {
      return this.client.uploadFile<TelegramMessage>(
        'sendVideoNote',
        'video_note',
        options.videoNote,
        'video_note.mp4',
        {
          chat_id: options.chatId,
          duration: options.duration,
          length: options.length,
          disable_notification: options.disableNotification,
          protect_content: options.protectContent,
          reply_to_message_id: options.replyToMessageId,
        }
      );
    }

    return this.client.request<TelegramMessage>('sendVideoNote', {
      params: {
        chat_id: options.chatId,
        video_note: options.videoNote,
        duration: options.duration,
        length: options.length,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a venue
   */
  async sendVenue(options: SendVenueOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('sendVenue', {
      params: {
        chat_id: options.chatId,
        latitude: options.latitude,
        longitude: options.longitude,
        title: options.title,
        address: options.address,
        foursquare_id: options.foursquareId,
        foursquare_type: options.foursquareType,
        google_place_id: options.googlePlaceId,
        google_place_type: options.googlePlaceType,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a contact
   */
  async sendContact(options: SendContactOptions): Promise<TelegramMessage> {
    return this.client.request<TelegramMessage>('sendContact', {
      params: {
        chat_id: options.chatId,
        phone_number: options.phoneNumber,
        first_name: options.firstName,
        last_name: options.lastName,
        vcard: options.vcard,
        disable_notification: options.disableNotification,
        protect_content: options.protectContent,
        reply_to_message_id: options.replyToMessageId,
      },
    });
  }

  /**
   * Send a chat action (typing, uploading, etc.)
   */
  async sendChatAction(options: SendChatActionOptions): Promise<boolean> {
    return this.client.request<boolean>('sendChatAction', {
      params: {
        chat_id: options.chatId,
        action: options.action,
      },
    });
  }

  /**
   * Edit a message caption
   */
  async editMessageCaption(options: EditMessageCaptionOptions): Promise<TelegramMessage | boolean> {
    return this.client.request<TelegramMessage | boolean>('editMessageCaption', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
        inline_message_id: options.inlineMessageId,
        caption: options.caption,
        parse_mode: options.parseMode,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }

  /**
   * Edit a message media
   */
  async editMessageMedia(options: EditMessageMediaOptions): Promise<TelegramMessage | boolean> {
    return this.client.request<TelegramMessage | boolean>('editMessageMedia', {
      body: {
        chat_id: options.chatId,
        message_id: options.messageId,
        inline_message_id: options.inlineMessageId,
        media: options.media,
        reply_markup: options.replyMarkup,
      },
    });
  }

  /**
   * Edit a message reply markup
   */
  async editMessageReplyMarkup(options: EditMessageReplyMarkupOptions): Promise<TelegramMessage | boolean> {
    return this.client.request<TelegramMessage | boolean>('editMessageReplyMarkup', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
        inline_message_id: options.inlineMessageId,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }

  /**
   * Stop a poll
   */
  async stopPoll(options: StopPollOptions): Promise<TelegramPoll> {
    return this.client.request<TelegramPoll>('stopPoll', {
      params: {
        chat_id: options.chatId,
        message_id: options.messageId,
        reply_markup: options.replyMarkup ? JSON.stringify(options.replyMarkup) : undefined,
      },
    });
  }
}
