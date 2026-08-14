import type { FigmaClient } from './client';
import type {
  FileResponse,
  FileNodesResponse,
  FileMetaResponse,
  ImageResponse,
  ImageFillsResponse,
  ImageExportOptions,
  VersionsResponse,
} from '../types';

/**
 * Figma Files API
 */
export class FilesApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get file information
   * @param fileKey - The file key (can be extracted from the Figma URL)
   * @param options - Optional parameters
   */
  async getFile(
    fileKey: string,
    options: {
      version?: string;
      ids?: string[];
      depth?: number;
      geometry?: 'paths' | 'bounds';
      plugin_data?: string;
      branch_data?: boolean;
    } = {}
  ): Promise<FileResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      version: options.version,
      depth: options.depth,
      geometry: options.geometry,
      plugin_data: options.plugin_data,
      branch_data: options.branch_data,
    };

    if (options.ids && options.ids.length > 0) {
      params.ids = options.ids.join(',');
    }

    return this.client.request<FileResponse>(`/files/${fileKey}`, { params });
  }

  /**
   * Get specific nodes from a file
   * @param fileKey - The file key
   * @param nodeIds - The IDs of the nodes to retrieve
   * @param options - Optional parameters
   */
  async getFileNodes(
    fileKey: string,
    nodeIds: string[],
    options: {
      version?: string;
      depth?: number;
      geometry?: 'paths' | 'bounds';
      plugin_data?: string;
    } = {}
  ): Promise<FileNodesResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      ids: nodeIds.join(','),
      version: options.version,
      depth: options.depth,
      geometry: options.geometry,
      plugin_data: options.plugin_data,
    };

    return this.client.request<FileNodesResponse>(`/files/${fileKey}/nodes`, { params });
  }

  /**
   * Export images from a file
   * @param fileKey - The file key
   * @param options - Export options
   */
  async getImages(
    fileKey: string,
    options: ImageExportOptions
  ): Promise<ImageResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      ids: options.ids.join(','),
      scale: options.scale,
      format: options.format,
      svg_include_id: options.svg_include_id,
      svg_include_node_id: options.svg_include_node_id,
      svg_simplify_stroke: options.svg_simplify_stroke,
      use_absolute_bounds: options.use_absolute_bounds,
      version: options.version,
    };

    return this.client.request<ImageResponse>(`/images/${fileKey}`, { params });
  }

  /**
   * Get image fills (URLs to images used in image fills)
   * @param fileKey - The file key
   */
  async getImageFills(fileKey: string): Promise<ImageFillsResponse> {
    return this.client.request<ImageFillsResponse>(`/files/${fileKey}/images`);
  }

  /**
   * Get file versions
   * @param fileKey - The file key
   * @param options - Optional parameters
   */
  async getVersions(
    fileKey: string,
    options: {
      page_size?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<VersionsResponse> {
    return this.client.request<VersionsResponse>(`/files/${fileKey}/versions`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Get file metadata (lightweight endpoint without document tree)
   * @param fileKey - The file key
   */
  async getFileMeta(fileKey: string): Promise<FileMetaResponse> {
    return this.client.request<FileMetaResponse>(`/files/${fileKey}/meta`);
  }
}
