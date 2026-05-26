import type { YouTubeClient } from './client';
import type { InvideoBranding, WatermarkTiming, WatermarkPosition } from '../types';

export interface WatermarkSetParams {
  channelId: string;
  onBehalfOfContentOwner?: string;
}

export class WatermarksApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * Set a watermark (branding) image for a channel
   * Quota cost: 50 units
   *
   * The watermark image should be:
   * - PNG or GIF format (GIF for animated)
   * - Transparent background recommended
   * - 150x150 pixels recommended
   */
  async set(
    channelId: string,
    imageData: Buffer | Uint8Array,
    timing: WatermarkTiming,
    position?: WatermarkPosition,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    const branding: InvideoBranding = {
      targetChannelId: channelId,
      timing,
      position: position || {
        type: 'corner',
        cornerPosition: 'bottomRight',
      },
    };

    // For image upload, we need to use multipart
    // This is a simplified version that uses base64 encoding
    const imageBase64 = Buffer.from(imageData).toString('base64');
    branding.imageBytes = imageBase64;

    await this.client.post('/watermarks/set', branding as unknown as Record<string, unknown>, {
      channelId,
      onBehalfOfContentOwner,
    });
  }

  /**
   * Set watermark from file
   */
  async setFromFile(
    channelId: string,
    filePath: string,
    timing: WatermarkTiming,
    position?: WatermarkPosition,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    const { readFileSync } = await import('fs');
    const imageData = readFileSync(filePath);
    return this.set(channelId, imageData, timing, position, onBehalfOfContentOwner);
  }

  /**
   * Set watermark to show from start of video
   */
  async setFromStart(
    channelId: string,
    imageData: Buffer | Uint8Array,
    offsetMs = 0,
    durationMs?: string,
    position?: WatermarkPosition
  ): Promise<void> {
    return this.set(channelId, imageData, {
      type: 'offsetFromStart',
      offsetMs: String(offsetMs),
      durationMs,
    }, position);
  }

  /**
   * Set watermark to show until end of video
   */
  async setFromEnd(
    channelId: string,
    imageData: Buffer | Uint8Array,
    offsetMs = 0,
    durationMs?: string,
    position?: WatermarkPosition
  ): Promise<void> {
    return this.set(channelId, imageData, {
      type: 'offsetFromEnd',
      offsetMs: String(offsetMs),
      durationMs,
    }, position);
  }

  /**
   * Remove/unset watermark from a channel
   * Quota cost: 50 units
   */
  async unset(
    channelId: string,
    onBehalfOfContentOwner?: string
  ): Promise<void> {
    await this.client.post('/watermarks/unset', undefined, {
      channelId,
      onBehalfOfContentOwner,
    });
  }
}
