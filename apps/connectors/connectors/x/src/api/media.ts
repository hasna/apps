/**
 * Media Upload API (v1.1)
 * Uses OAuth 1.0a for authentication
 */

import { readFileSync, statSync } from 'fs';
import { basename } from 'path';
import { OAuth1Client } from './oauth1';

const UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

// Media categories
export type MediaCategory = 'tweet_image' | 'tweet_gif' | 'tweet_video' | 'dm_image' | 'dm_gif' | 'dm_video';

// MIME types
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

// Max file sizes (in bytes)
const MAX_SIZES = {
  image: 5 * 1024 * 1024, // 5MB
  gif: 15 * 1024 * 1024, // 15MB
  video: 512 * 1024 * 1024, // 512MB
};

// Chunk size for large uploads
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

export interface MediaUploadResult {
  media_id: number;
  media_id_string: string;
  media_key?: string;
  size?: number;
  expires_after_secs?: number;
  image?: {
    image_type: string;
    w: number;
    h: number;
  };
  video?: {
    video_type: string;
  };
  processing_info?: {
    state: 'pending' | 'in_progress' | 'failed' | 'succeeded';
    check_after_secs?: number;
    progress_percent?: number;
    error?: {
      code: number;
      name: string;
      message: string;
    };
  };
}

export interface MediaUploadOptions {
  altText?: string;
  category?: MediaCategory;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Determine media category from MIME type
 */
function getMediaCategory(mimeType: string): MediaCategory {
  if (mimeType.startsWith('video/')) {
    return 'tweet_video';
  }
  if (mimeType === 'image/gif') {
    return 'tweet_gif';
  }
  return 'tweet_image';
}

/**
 * Check if file requires chunked upload
 */
function requiresChunkedUpload(mimeType: string, fileSize: number): boolean {
  // Videos always use chunked upload
  if (mimeType.startsWith('video/')) {
    return true;
  }
  // GIFs over 5MB use chunked upload
  if (mimeType === 'image/gif' && fileSize > 5 * 1024 * 1024) {
    return true;
  }
  return false;
}

/**
 * Simple upload for small images
 */
async function simpleUpload(
  oauth1Client: OAuth1Client,
  fileData: Buffer,
  mimeType: string
): Promise<MediaUploadResult> {
  const base64Data = fileData.toString('base64');

  const result = await oauth1Client.post<MediaUploadResult>(UPLOAD_URL, {
    media_data: base64Data,
  });

  return result;
}

/**
 * Chunked upload for large files and videos
 */
async function chunkedUpload(
  oauth1Client: OAuth1Client,
  fileData: Buffer,
  mimeType: string,
  category: MediaCategory
): Promise<MediaUploadResult> {
  const totalBytes = fileData.length;

  // INIT
  const initResult = await oauth1Client.post<MediaUploadResult>(UPLOAD_URL, {
    command: 'INIT',
    total_bytes: totalBytes.toString(),
    media_type: mimeType,
    media_category: category,
  });

  const mediaId = initResult.media_id_string;

  // APPEND chunks
  let segmentIndex = 0;
  let offset = 0;

  while (offset < totalBytes) {
    const chunk = fileData.subarray(offset, Math.min(offset + CHUNK_SIZE, totalBytes));
    const chunkBase64 = chunk.toString('base64');

    await oauth1Client.post(UPLOAD_URL, {
      command: 'APPEND',
      media_id: mediaId,
      media_data: chunkBase64,
      segment_index: segmentIndex.toString(),
    });

    offset += CHUNK_SIZE;
    segmentIndex++;
  }

  // FINALIZE
  const finalizeResult = await oauth1Client.post<MediaUploadResult>(UPLOAD_URL, {
    command: 'FINALIZE',
    media_id: mediaId,
  });

  return finalizeResult;
}

/**
 * Wait for video processing to complete
 */
async function waitForProcessing(
  oauth1Client: OAuth1Client,
  mediaId: string,
  maxWaitMs: number = 60000
): Promise<MediaUploadResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const status = await oauth1Client.get<MediaUploadResult>(UPLOAD_URL, {
      command: 'STATUS',
      media_id: mediaId,
    });

    if (!status.processing_info) {
      return status;
    }

    const { state, check_after_secs, error } = status.processing_info;

    if (state === 'succeeded') {
      return status;
    }

    if (state === 'failed') {
      throw new Error(
        `Media processing failed: ${error?.message || 'Unknown error'}`
      );
    }

    // Wait before checking again
    const waitMs = (check_after_secs || 5) * 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  throw new Error('Media processing timed out');
}

/**
 * Add alt text to media
 */
async function addAltText(
  oauth1Client: OAuth1Client,
  mediaId: string,
  altText: string
): Promise<void> {
  const url = 'https://upload.twitter.com/1.1/media/metadata/create.json';

  await oauth1Client.post(
    url,
    JSON.stringify({
      media_id: mediaId,
      alt_text: { text: altText },
    }),
    { 'Content-Type': 'application/json' }
  );
}

/**
 * Media Upload API class
 */
export class MediaApi {
  private oauth1Client: OAuth1Client;

  constructor(oauth1Client: OAuth1Client) {
    this.oauth1Client = oauth1Client;
  }

  /**
   * Upload media from a file path
   */
  async uploadFile(
    filePath: string,
    options: MediaUploadOptions = {}
  ): Promise<MediaUploadResult> {
    const fileData = readFileSync(filePath);
    const fileSize = statSync(filePath).size;
    const mimeType = getMimeType(filePath);

    return this.uploadBuffer(fileData, mimeType, {
      ...options,
      category: options.category || getMediaCategory(mimeType),
    });
  }

  /**
   * Upload media from a buffer
   */
  async uploadBuffer(
    data: Buffer,
    mimeType: string,
    options: MediaUploadOptions = {}
  ): Promise<MediaUploadResult> {
    const fileSize = data.length;
    const category = options.category || getMediaCategory(mimeType);

    // Validate size
    const maxSize = mimeType.startsWith('video/')
      ? MAX_SIZES.video
      : mimeType === 'image/gif'
        ? MAX_SIZES.gif
        : MAX_SIZES.image;

    if (fileSize > maxSize) {
      throw new Error(
        `File size ${fileSize} exceeds maximum ${maxSize} bytes for ${mimeType}`
      );
    }

    let result: MediaUploadResult;

    // Choose upload method
    if (requiresChunkedUpload(mimeType, fileSize)) {
      result = await chunkedUpload(this.oauth1Client, data, mimeType, category);

      // Wait for processing if video
      if (result.processing_info) {
        result = await waitForProcessing(
          this.oauth1Client,
          result.media_id_string
        );
      }
    } else {
      result = await simpleUpload(this.oauth1Client, data, mimeType);
    }

    // Add alt text if provided
    if (options.altText) {
      await addAltText(this.oauth1Client, result.media_id_string, options.altText);
    }

    return result;
  }

  /**
   * Upload media from a URL
   */
  async uploadFromUrl(
    url: string,
    options: MediaUploadOptions = {}
  ): Promise<MediaUploadResult> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch media from URL: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    return this.uploadBuffer(buffer, contentType, options);
  }
}
