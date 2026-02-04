import type { FigmaClient } from './client';
import type {
  TeamStylesResponse,
  Style,
} from '../types';

/**
 * Figma Styles API
 */
export class StylesApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get team styles
   * @param teamId - The team ID
   * @param options - Optional parameters
   */
  async getTeamStyles(
    teamId: string,
    options: {
      page_size?: number;
      after?: number;
      before?: number;
    } = {}
  ): Promise<TeamStylesResponse> {
    return this.client.request<TeamStylesResponse>(`/teams/${teamId}/styles`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Get file styles
   * @param fileKey - The file key
   */
  async getFileStyles(fileKey: string): Promise<{ meta: { styles: Style[] } }> {
    return this.client.request<{ meta: { styles: Style[] } }>(`/files/${fileKey}/styles`);
  }

  /**
   * Get a specific style by key
   * @param styleKey - The style key
   */
  async getStyle(styleKey: string): Promise<{ meta: Style }> {
    return this.client.request<{ meta: Style }>(`/styles/${styleKey}`);
  }
}
