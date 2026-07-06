// Zoho Inventory Connector — Inventory management for items, orders, and invoices
import { ZohoInventoryClient } from './client';
import type {
  ZohoInventoryConfig,
  ZIContact,
  ZIItem,
  ZISalesOrder,
  ZIPurchaseOrder,
  ZIInvoice,
} from '../types';

export { ZohoInventoryClient } from './client';

export class ZohoInventory {
  private readonly client: ZohoInventoryClient;

  constructor(config: ZohoInventoryConfig) {
    this.client = new ZohoInventoryClient(config);
  }

  static fromEnv(): ZohoInventory {
    const token = process.env.ZOHOINVENTORY_TOKEN;
    const organizationId = process.env.ZOHOINVENTORY_ORG_ID;
    if (!token || !organizationId) {
      throw new Error('ZOHOINVENTORY_TOKEN and ZOHOINVENTORY_ORG_ID are required');
    }
    return new ZohoInventory({
      token,
      organizationId,
      baseUrl: process.env.ZOHOINVENTORY_BASE_URL,
    });
  }

  async listContacts(options?: { page?: number; per_page?: number; contact_type?: string }): Promise<{ contacts: ZIContact[] }> {
    return this.client.request('/contacts', {
      params: { page: options?.page, per_page: options?.per_page, contact_type: options?.contact_type },
    });
  }

  async listItems(options?: { page?: number; per_page?: number }): Promise<{ items: ZIItem[] }> {
    return this.client.request('/items', { params: { page: options?.page, per_page: options?.per_page } });
  }

  async getItem(itemId: string): Promise<{ item: ZIItem }> {
    return this.client.request(`/items/${encodeURIComponent(itemId)}`);
  }

  async listSalesOrders(options?: { page?: number; per_page?: number; status?: string }): Promise<{ salesorders: ZISalesOrder[] }> {
    return this.client.request('/salesorders', {
      params: { page: options?.page, per_page: options?.per_page, status: options?.status },
    });
  }

  async listPurchaseOrders(options?: { page?: number; per_page?: number; status?: string }): Promise<{ purchaseorders: ZIPurchaseOrder[] }> {
    return this.client.request('/purchaseorders', {
      params: { page: options?.page, per_page: options?.per_page, status: options?.status },
    });
  }

  async listInvoices(options?: { page?: number; per_page?: number; status?: string }): Promise<{ invoices: ZIInvoice[] }> {
    return this.client.request('/invoices', {
      params: { page: options?.page, per_page: options?.per_page, status: options?.status },
    });
  }

  getClient(): ZohoInventoryClient {
    return this.client;
  }
}
