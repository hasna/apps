import type { MercuryClient } from './client';

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  type: 'income' | 'expense';
  isSystem: boolean;
  createdAt: string;
}

export interface CategoryListResponse {
  categories: Category[];
  total: number;
}

/**
 * Mercury Categories API
 * Manage transaction categories
 */
export class CategoriesApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List all categories
   */
  async list(params?: { limit?: number; offset?: number }): Promise<CategoryListResponse> {
    return this.client.get<CategoryListResponse>('/categories', {
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  /**
   * Get a category by ID
   */
  async get(categoryId: string): Promise<Category> {
    return this.client.get<Category>(`/categories/${categoryId}`);
  }
}
