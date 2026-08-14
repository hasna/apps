import type {
  EraseOptions,
  SearchAndReplaceOptions,
  RemoveBackgroundOptions,
  ReplaceBackgroundOptions,
  EditResponse,
} from '../types';
import { StabilityClient } from './client';

/**
 * Edit API
 * Various image editing operations
 */
export class EditApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Erase objects from an image (v2 API)
   * Remove unwanted elements using a mask
   */
  async erase(options: EraseOptions): Promise<EditResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    if (options.mask) {
      const maskBlob = StabilityClient.createImageBlob(options.mask);
      formData.append('mask', maskBlob, 'mask.png');
    }
    if (options.growMask !== undefined) {
      formData.append('grow_mask', options.growMask.toString());
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }

    return this.client.requestMultipart<EditResponse>(
      '/stable-image/edit/erase',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Search and replace objects in an image (v2 API)
   * Find objects matching a description and replace them
   */
  async searchAndReplace(options: SearchAndReplaceOptions): Promise<EditResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    formData.append('prompt', options.prompt);
    formData.append('search_prompt', options.searchPrompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }
    if (options.growMask !== undefined) {
      formData.append('grow_mask', options.growMask.toString());
    }

    return this.client.requestMultipart<EditResponse>(
      '/stable-image/edit/search-and-replace',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Remove background from an image (v2 API)
   * Creates a transparent background
   */
  async removeBackground(options: RemoveBackgroundOptions): Promise<EditResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }

    return this.client.requestMultipart<EditResponse>(
      '/stable-image/edit/remove-background',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Replace background of an image (v2 API)
   * Generate a new background based on a prompt
   */
  async replaceBackground(options: ReplaceBackgroundOptions): Promise<EditResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    formData.append('prompt', options.prompt);

    if (options.negativePrompt) {
      formData.append('negative_prompt', options.negativePrompt);
    }
    if (options.seed !== undefined) {
      formData.append('seed', options.seed.toString());
    }
    if (options.outputFormat) {
      formData.append('output_format', options.outputFormat);
    }

    return this.client.requestMultipart<EditResponse>(
      '/stable-image/edit/replace-background',
      formData,
      { version: 'v2' }
    );
  }
}
