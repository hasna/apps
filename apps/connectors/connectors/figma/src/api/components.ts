import type { FigmaClient } from './client';
import type {
  TeamComponentsResponse,
  TeamComponentSetsResponse,
  Component,
  ComponentSet,
} from '../types';

/**
 * Figma Components API
 */
export class ComponentsApi {
  constructor(private readonly client: FigmaClient) {}

  /**
   * Get team components
   * @param teamId - The team ID
   * @param options - Optional parameters
   */
  async getTeamComponents(
    teamId: string,
    options: {
      page_size?: number;
      after?: number;
      before?: number;
    } = {}
  ): Promise<TeamComponentsResponse> {
    return this.client.request<TeamComponentsResponse>(`/teams/${teamId}/components`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Get team component sets
   * @param teamId - The team ID
   * @param options - Optional parameters
   */
  async getTeamComponentSets(
    teamId: string,
    options: {
      page_size?: number;
      after?: number;
      before?: number;
    } = {}
  ): Promise<TeamComponentSetsResponse> {
    return this.client.request<TeamComponentSetsResponse>(`/teams/${teamId}/component_sets`, {
      params: options as Record<string, string | number | boolean | undefined>,
    });
  }

  /**
   * Get file components
   * @param fileKey - The file key
   */
  async getFileComponents(fileKey: string): Promise<{ meta: { components: Component[] } }> {
    return this.client.request<{ meta: { components: Component[] } }>(`/files/${fileKey}/components`);
  }

  /**
   * Get file component sets
   * @param fileKey - The file key
   */
  async getFileComponentSets(fileKey: string): Promise<{ meta: { component_sets: ComponentSet[] } }> {
    return this.client.request<{ meta: { component_sets: ComponentSet[] } }>(`/files/${fileKey}/component_sets`);
  }

  /**
   * Get a specific component by key
   * @param componentKey - The component key
   */
  async getComponent(componentKey: string): Promise<{ meta: Component }> {
    return this.client.request<{ meta: Component }>(`/components/${componentKey}`);
  }

  /**
   * Get a specific component set by key
   * @param componentSetKey - The component set key
   */
  async getComponentSet(componentSetKey: string): Promise<{ meta: ComponentSet }> {
    return this.client.request<{ meta: ComponentSet }>(`/component_sets/${componentSetKey}`);
  }
}
