import type {
  TelegramAnimation,
  TelegramAudio,
  TelegramDocument,
  TelegramMessage,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramVideo,
  TelegramVideoNote,
  TelegramVoice,
} from '../types';

type TelegramMedia =
  | ({ type: 'photo' } & TelegramPhotoSize)
  | ({ type: 'animation' } & TelegramAnimation)
  | ({ type: 'document' } & TelegramDocument)
  | ({ type: 'audio' } & TelegramAudio)
  | ({ type: 'video' } & TelegramVideo)
  | ({ type: 'voice' } & TelegramVoice)
  | ({ type: 'video_note' } & TelegramVideoNote);

export function getMessageMedia(message: TelegramMessage): TelegramMedia | undefined {
  const photo = message.photo?.at(-1);
  if (photo) {
    return { type: 'photo', ...photo };
  }
  if (message.animation) {
    return { type: 'animation', ...message.animation };
  }
  if (message.document) {
    return { type: 'document', ...message.document };
  }
  if (message.audio) {
    return { type: 'audio', ...message.audio };
  }
  if (message.video) {
    return { type: 'video', ...message.video };
  }
  if (message.voice) {
    return { type: 'voice', ...message.voice };
  }
  if (message.video_note) {
    return { type: 'video_note', ...message.video_note };
  }
  return undefined;
}

function formatMessage(
  result: Record<string, unknown>,
  type: string,
  message: TelegramMessage
): void {
  result.type = type;
  result.message_id = message.message_id;
  result.from = message.from?.username || message.from?.first_name || 'unknown';
  result.chat_id = message.chat.id;
  if (message.text !== undefined) {
    result.text = message.text;
  }
  if (message.caption !== undefined) {
    result.caption = message.caption;
  }

  const media = getMessageMedia(message);
  if (media) {
    result.media = media;
  }
  result.date = new Date(message.date * 1000).toISOString();
}

export function formatUpdate(update: TelegramUpdate): Record<string, unknown> {
  const result: Record<string, unknown> = {
    update_id: update.update_id,
  };

  if (update.message) {
    formatMessage(result, 'message', update.message);
  } else if (update.callback_query) {
    result.type = 'callback_query';
    result.from = update.callback_query.from.username || update.callback_query.from.first_name;
    result.data = update.callback_query.data;
  } else if (update.inline_query) {
    result.type = 'inline_query';
    result.from = update.inline_query.from.username || update.inline_query.from.first_name;
    result.query = update.inline_query.query;
  } else if (update.edited_message) {
    formatMessage(result, 'edited_message', update.edited_message);
  } else if (update.channel_post) {
    formatMessage(result, 'channel_post', update.channel_post);
  } else if (update.edited_channel_post) {
    formatMessage(result, 'edited_channel_post', update.edited_channel_post);
  }

  return result;
}
