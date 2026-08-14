import type { TelegramClient } from './client';
import type { TelegramUser, TelegramFile } from '../types';

export interface BotCommand {
  command: string;
  description: string;
}

export interface BotCommandScope {
  type: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators' | 'chat' | 'chat_administrators' | 'chat_member';
  chat_id?: number | string;
  user_id?: number;
}

export interface SetMyCommandsOptions {
  commands: BotCommand[];
  scope?: BotCommandScope;
  languageCode?: string;
}

export interface DeleteMyCommandsOptions {
  scope?: BotCommandScope;
  languageCode?: string;
}

export interface GetMyCommandsOptions {
  scope?: BotCommandScope;
  languageCode?: string;
}

export interface SetMyNameOptions {
  name?: string;
  languageCode?: string;
}

export interface GetMyNameOptions {
  languageCode?: string;
}

export interface SetMyDescriptionOptions {
  description?: string;
  languageCode?: string;
}

export interface GetMyDescriptionOptions {
  languageCode?: string;
}

export interface SetMyShortDescriptionOptions {
  shortDescription?: string;
  languageCode?: string;
}

export interface GetMyShortDescriptionOptions {
  languageCode?: string;
}

export interface GetFileOptions {
  fileId: string;
}

export interface DownloadFileResult {
  file: TelegramFile;
  data: Uint8Array;
}

export interface BotName {
  name: string;
}

export interface BotDescription {
  description: string;
}

export interface BotShortDescription {
  short_description: string;
}

/**
 * Telegram Bot API
 */
export class BotApi {
  constructor(private readonly client: TelegramClient) {}

  /**
   * Get bot information
   */
  async getMe(): Promise<TelegramUser> {
    return this.client.request<TelegramUser>('getMe', {
      method: 'GET',
    });
  }

  /**
   * Log out from the cloud Bot API server
   */
  async logOut(): Promise<boolean> {
    return this.client.request<boolean>('logOut');
  }

  /**
   * Close the bot instance
   */
  async close(): Promise<boolean> {
    return this.client.request<boolean>('close');
  }

  /**
   * Set bot commands
   */
  async setMyCommands(options: SetMyCommandsOptions): Promise<boolean> {
    return this.client.request<boolean>('setMyCommands', {
      params: {
        commands: JSON.stringify(options.commands),
        scope: options.scope ? JSON.stringify(options.scope) : undefined,
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Delete bot commands
   */
  async deleteMyCommands(options: DeleteMyCommandsOptions = {}): Promise<boolean> {
    return this.client.request<boolean>('deleteMyCommands', {
      params: {
        scope: options.scope ? JSON.stringify(options.scope) : undefined,
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Get bot commands
   */
  async getMyCommands(options: GetMyCommandsOptions = {}): Promise<BotCommand[]> {
    return this.client.request<BotCommand[]>('getMyCommands', {
      method: 'GET',
      params: {
        scope: options.scope ? JSON.stringify(options.scope) : undefined,
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Set bot name
   */
  async setMyName(options: SetMyNameOptions = {}): Promise<boolean> {
    return this.client.request<boolean>('setMyName', {
      params: {
        name: options.name,
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Get bot name
   */
  async getMyName(options: GetMyNameOptions = {}): Promise<BotName> {
    return this.client.request<BotName>('getMyName', {
      method: 'GET',
      params: {
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Set bot description
   */
  async setMyDescription(options: SetMyDescriptionOptions = {}): Promise<boolean> {
    return this.client.request<boolean>('setMyDescription', {
      params: {
        description: options.description,
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Get bot description
   */
  async getMyDescription(options: GetMyDescriptionOptions = {}): Promise<BotDescription> {
    return this.client.request<BotDescription>('getMyDescription', {
      method: 'GET',
      params: {
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Set bot short description
   */
  async setMyShortDescription(options: SetMyShortDescriptionOptions = {}): Promise<boolean> {
    return this.client.request<boolean>('setMyShortDescription', {
      params: {
        short_description: options.shortDescription,
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Get bot short description
   */
  async getMyShortDescription(options: GetMyShortDescriptionOptions = {}): Promise<BotShortDescription> {
    return this.client.request<BotShortDescription>('getMyShortDescription', {
      method: 'GET',
      params: {
        language_code: options.languageCode,
      },
    });
  }

  /**
   * Get file information
   */
  async getFile(options: GetFileOptions): Promise<TelegramFile> {
    return this.client.request<TelegramFile>('getFile', {
      params: {
        file_id: options.fileId,
      },
    });
  }

  /**
   * Resolve and download a Telegram file
   */
  async downloadFile(options: GetFileOptions): Promise<DownloadFileResult> {
    const file = await this.getFile(options);
    if (!file.file_path) {
      throw new Error('Telegram did not return a downloadable file path');
    }

    return {
      file,
      data: await this.client.downloadFile(file.file_path),
    };
  }
}
