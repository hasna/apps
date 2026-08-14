import type { FigmaClient } from './client';
import type {
  LocalVariablesResponse,
  PublishedVariablesResponse,
} from '../types';

/**
 * Figma Variables API
 */
export class VariablesApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get local variables in a file
   * @param fileKey - The file key
   */
  async getLocalVariables(fileKey: string): Promise<LocalVariablesResponse> {
    return this.client.request<LocalVariablesResponse>(`/files/${fileKey}/variables/local`);
  }

  /**
   * Get published variables in a file
   * @param fileKey - The file key
   */
  async getPublishedVariables(fileKey: string): Promise<PublishedVariablesResponse> {
    return this.client.request<PublishedVariablesResponse>(`/files/${fileKey}/variables/published`);
  }

  /**
   * Create/update/delete variables in a file
   * This endpoint supports bulk operations on variables and variable collections
   * @param fileKey - The file key
   * @param operations - The operations to perform
   */
  async postVariables(
    fileKey: string,
    operations: {
      variableCollections?: Array<{
        action: 'CREATE' | 'UPDATE' | 'DELETE';
        id?: string;
        name?: string;
        initialModeId?: string;
      }>;
      variableModes?: Array<{
        action: 'CREATE' | 'UPDATE' | 'DELETE';
        id?: string;
        variableCollectionId?: string;
        name?: string;
      }>;
      variables?: Array<{
        action: 'CREATE' | 'UPDATE' | 'DELETE';
        id?: string;
        name?: string;
        variableCollectionId?: string;
        resolvedType?: 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';
        description?: string;
        hiddenFromPublishing?: boolean;
        scopes?: string[];
        codeSyntax?: Record<string, string>;
      }>;
      variableModeValues?: Array<{
        variableId: string;
        modeId: string;
        value: unknown;
      }>;
    }
  ): Promise<LocalVariablesResponse> {
    return this.client.request<LocalVariablesResponse>(`/files/${fileKey}/variables`, {
      method: 'POST',
      body: operations,
    });
  }
}
