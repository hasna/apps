import { describe, expect, test } from 'bun:test';
import type { TelegramMessage, TelegramUpdate } from '../types';
import { formatUpdate } from './updates';

function updateWith(message: Partial<TelegramMessage>): TelegramUpdate {
  return {
    update_id: 428687256,
    message: {
      message_id: 42,
      date: 1,
      chat: { id: 123, type: 'private' },
      from: {
        id: 456,
        is_bot: false,
        first_name: 'Andrei',
        username: 'andrei',
      },
      ...message,
    },
  };
}

describe('Telegram update formatting', () => {
  test('exposes the largest incoming photo file ID and caption', () => {
    const formatted = formatUpdate(updateWith({
      caption: 'Please inspect this screenshot',
      photo: [
        {
          file_id: 'small-photo-id',
          file_unique_id: 'small-unique-id',
          width: 90,
          height: 90,
          file_size: 100,
        },
        {
          file_id: 'large-photo-id',
          file_unique_id: 'large-unique-id',
          width: 1280,
          height: 720,
          file_size: 5000,
        },
      ],
    }));

    expect(formatted).toMatchObject({
      update_id: 428687256,
      type: 'message',
      message_id: 42,
      caption: 'Please inspect this screenshot',
      media: {
        type: 'photo',
        file_id: 'large-photo-id',
        file_unique_id: 'large-unique-id',
        width: 1280,
        height: 720,
        file_size: 5000,
      },
    });
    expect(formatted).not.toHaveProperty('text', '[media]');
  });

  test('exposes actionable metadata for every typed downloadable media kind', () => {
    const cases: Array<{
      mediaType: string;
      message: Partial<TelegramMessage>;
      fileId: string;
      expected: Record<string, unknown>;
    }> = [
      {
        mediaType: 'animation',
        fileId: 'animation-id',
        message: {
          animation: {
            file_id: 'animation-id',
            file_unique_id: 'animation-unique-id',
            width: 640,
            height: 360,
            duration: 4,
            file_name: 'instruction.gif',
            mime_type: 'image/gif',
            file_size: 2500,
          },
        },
        expected: {
          width: 640,
          height: 360,
          duration: 4,
          file_name: 'instruction.gif',
          mime_type: 'image/gif',
        },
      },
      {
        mediaType: 'document',
        fileId: 'document-id',
        message: {
          document: {
            file_id: 'document-id',
            file_unique_id: 'document-unique-id',
            file_name: 'instructions.pdf',
            mime_type: 'application/pdf',
            file_size: 1000,
          },
        },
        expected: {
          file_name: 'instructions.pdf',
          mime_type: 'application/pdf',
        },
      },
      {
        mediaType: 'audio',
        fileId: 'audio-id',
        message: {
          audio: {
            file_id: 'audio-id',
            file_unique_id: 'audio-unique-id',
            duration: 12,
            file_name: 'note.mp3',
            mime_type: 'audio/mpeg',
          },
        },
        expected: { duration: 12, file_name: 'note.mp3', mime_type: 'audio/mpeg' },
      },
      {
        mediaType: 'video',
        fileId: 'video-id',
        message: {
          video: {
            file_id: 'video-id',
            file_unique_id: 'video-unique-id',
            width: 1920,
            height: 1080,
            duration: 8,
            file_name: 'screen.mp4',
            mime_type: 'video/mp4',
          },
        },
        expected: { width: 1920, height: 1080, duration: 8, file_name: 'screen.mp4' },
      },
      {
        mediaType: 'voice',
        fileId: 'voice-id',
        message: {
          voice: {
            file_id: 'voice-id',
            file_unique_id: 'voice-unique-id',
            duration: 5,
            mime_type: 'audio/ogg',
          },
        },
        expected: { duration: 5, mime_type: 'audio/ogg' },
      },
      {
        mediaType: 'video_note',
        fileId: 'video-note-id',
        message: {
          video_note: {
            file_id: 'video-note-id',
            file_unique_id: 'video-note-unique-id',
            length: 384,
            duration: 6,
          },
        },
        expected: { length: 384, duration: 6 },
      },
    ];

    for (const testCase of cases) {
      const formatted = formatUpdate(updateWith(testCase.message));
      expect(formatted.media).toMatchObject({
        type: testCase.mediaType,
        file_id: testCase.fileId,
        ...testCase.expected,
      });
    }
  });
});
