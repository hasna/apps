import type { E2BClient } from './client';
import type {
  FileInfo,
  DirectoryListing,
  FileWriteOptions,
  FileReadResult,
} from '../types';

/**
 * Filesystem API - Interact with sandbox filesystem
 */
export class FilesystemApi {
  constructor(private readonly client: E2BClient) {}

  /**
   * Read a file from the sandbox
   * @param sandboxId - The sandbox ID
   * @param path - Path to the file to read
   * @returns File content
   */
  async read(sandboxId: string, path: string): Promise<FileReadResult> {
    const response = await this.client.get<{ content: string } | string>(`/sandboxes/${sandboxId}/files`, {
      path,
    });

    // Handle both object and string responses
    if (typeof response === 'string') {
      return { path, content: response };
    }
    return { path, content: response.content };
  }

  /**
   * Write content to a file in the sandbox
   * @param sandboxId - The sandbox ID
   * @param path - Path to the file to write
   * @param content - Content to write
   */
  async write(sandboxId: string, path: string, content: string): Promise<void> {
    await this.client.put(`/sandboxes/${sandboxId}/files`, {
      path,
      content,
    });
  }

  /**
   * Write a file using options object
   * @param sandboxId - The sandbox ID
   * @param options - File write options
   */
  async writeFile(sandboxId: string, options: FileWriteOptions): Promise<void> {
    await this.write(sandboxId, options.path, options.content);
  }

  /**
   * List directory contents
   * @param sandboxId - The sandbox ID
   * @param path - Path to the directory (default: /)
   * @returns Directory listing
   */
  async list(sandboxId: string, path: string = '/'): Promise<DirectoryListing> {
    const entries = await this.client.get<FileInfo[]>(`/sandboxes/${sandboxId}/files/list`, {
      path,
    });

    return { path, entries: entries || [] };
  }

  /**
   * Create a directory
   * @param sandboxId - The sandbox ID
   * @param path - Path to the directory to create
   */
  async mkdir(sandboxId: string, path: string): Promise<void> {
    await this.client.post(`/sandboxes/${sandboxId}/files/mkdir`, {
      path,
    });
  }

  /**
   * Remove a file or directory
   * @param sandboxId - The sandbox ID
   * @param path - Path to the file or directory to remove
   */
  async remove(sandboxId: string, path: string): Promise<void> {
    await this.client.delete(`/sandboxes/${sandboxId}/files`, {
      path,
    });
  }

  /**
   * Check if a file or directory exists
   * @param sandboxId - The sandbox ID
   * @param path - Path to check
   * @returns True if exists, false otherwise
   */
  async exists(sandboxId: string, path: string): Promise<boolean> {
    try {
      await this.client.get(`/sandboxes/${sandboxId}/files/stat`, { path });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file/directory info (stat)
   * @param sandboxId - The sandbox ID
   * @param path - Path to the file or directory
   */
  async stat(sandboxId: string, path: string): Promise<FileInfo> {
    return this.client.get<FileInfo>(`/sandboxes/${sandboxId}/files/stat`, {
      path,
    });
  }

  /**
   * Move/rename a file or directory
   * @param sandboxId - The sandbox ID
   * @param from - Source path
   * @param to - Destination path
   */
  async move(sandboxId: string, from: string, to: string): Promise<void> {
    await this.client.post(`/sandboxes/${sandboxId}/files/move`, {
      from,
      to,
    });
  }

  /**
   * Copy a file or directory
   * @param sandboxId - The sandbox ID
   * @param from - Source path
   * @param to - Destination path
   */
  async copy(sandboxId: string, from: string, to: string): Promise<void> {
    await this.client.post(`/sandboxes/${sandboxId}/files/copy`, {
      from,
      to,
    });
  }

  /**
   * Get download URL for a file
   * @param sandboxId - The sandbox ID
   * @param path - Path to the file
   * @returns Download URL
   */
  async getDownloadUrl(sandboxId: string, path: string): Promise<string> {
    const response = await this.client.get<{ url: string }>(`/sandboxes/${sandboxId}/files/download`, {
      path,
    });
    return response.url;
  }

  /**
   * Get upload URL for a file
   * @param sandboxId - The sandbox ID
   * @param path - Path where the file will be uploaded
   * @returns Upload URL
   */
  async getUploadUrl(sandboxId: string, path: string): Promise<string> {
    const response = await this.client.get<{ url: string }>(`/sandboxes/${sandboxId}/files/upload`, {
      path,
    });
    return response.url;
  }
}
