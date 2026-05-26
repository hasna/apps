import type { TelegramClient } from './client';
import type { TelegramInlineQueryResult } from '../types';

export interface AnswerInlineQueryOptions {
  inlineQueryId: string;
  results: TelegramInlineQueryResult[];
  cacheTime?: number;
  isPersonal?: boolean;
  nextOffset?: string;
  button?: InlineQueryResultsButton;
}

export interface InlineQueryResultsButton {
  text: string;
  webApp?: { url: string };
  startParameter?: string;
}

export interface AnswerCallbackQueryOptions {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
  url?: string;
  cacheTime?: number;
}

/**
 * Telegram Inline API
 */
export class InlineApi {
  constructor(private readonly client: TelegramClient) {}

  /**
   * Answer an inline query
   */
  async answerInlineQuery(options: AnswerInlineQueryOptions): Promise<boolean> {
    return this.client.request<boolean>('answerInlineQuery', {
      params: {
        inline_query_id: options.inlineQueryId,
        results: JSON.stringify(options.results),
        cache_time: options.cacheTime,
        is_personal: options.isPersonal,
        next_offset: options.nextOffset,
        button: options.button ? JSON.stringify(options.button) : undefined,
      },
    });
  }

  /**
   * Answer a callback query
   */
  async answerCallbackQuery(options: AnswerCallbackQueryOptions): Promise<boolean> {
    return this.client.request<boolean>('answerCallbackQuery', {
      params: {
        callback_query_id: options.callbackQueryId,
        text: options.text,
        show_alert: options.showAlert,
        url: options.url,
        cache_time: options.cacheTime,
      },
    });
  }
}
