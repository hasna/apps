import type {
  StableFast3DOptions,
  StableFast3DResponse,
  StableVideo3DOptions,
  StableVideo3DResponse,
} from '../types';
import { StabilityClient } from './client';

/**
 * 3D API
 * Generate 3D models from images
 */
export class ThreeDApi {
  constructor(private readonly client: StabilityClient) {}

  /**
   * Generate 3D model using Stable Fast 3D (v2 API)
   * Fast single-view 3D reconstruction
   */
  async stableFast3D(options: StableFast3DOptions): Promise<StableFast3DResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    if (options.textureResolution !== undefined) {
      formData.append('texture_resolution', options.textureResolution.toString());
    }
    if (options.foregroundRatio !== undefined) {
      formData.append('foreground_ratio', options.foregroundRatio.toString());
    }
    if (options.remesh) {
      formData.append('remesh', options.remesh);
    }
    if (options.vertexCount !== undefined) {
      formData.append('vertex_count', options.vertexCount.toString());
    }

    const response = await this.client.request<{ glb?: string }>(
      '/3d/stable-fast-3d',
      {
        method: 'POST',
        body: formData,
        version: 'v2',
        responseType: 'json',
      }
    );

    // Response may be binary GLB or JSON with base64
    if (response.glb) {
      return response as StableFast3DResponse;
    }

    // If we get binary data back, it's the GLB file directly
    // The multipart request will handle this case
    return this.client.requestMultipart<StableFast3DResponse>(
      '/3d/stable-fast-3d',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Generate 3D model using Stable Video 3D (SV3D) (v2 API)
   * Multi-view 3D generation, produces higher quality results
   */
  async stableVideo3D(options: StableVideo3DOptions): Promise<StableVideo3DResponse> {
    const formData = new FormData();

    const imageBlob = StabilityClient.createImageBlob(options.image);
    formData.append('image', imageBlob, 'image.png');

    if (options.textureResolution !== undefined) {
      formData.append('texture_resolution', options.textureResolution.toString());
    }
    if (options.foregroundRatio !== undefined) {
      formData.append('foreground_ratio', options.foregroundRatio.toString());
    }
    if (options.remesh) {
      formData.append('remesh', options.remesh);
    }
    if (options.vertexCount !== undefined) {
      formData.append('vertex_count', options.vertexCount.toString());
    }

    return this.client.requestMultipart<StableVideo3DResponse>(
      '/3d/stable-video-3d',
      formData,
      { version: 'v2' }
    );
  }

  /**
   * Generate 3D model using the default method (Stable Fast 3D)
   */
  async generate(options: StableFast3DOptions): Promise<StableFast3DResponse> {
    return this.stableFast3D(options);
  }
}
