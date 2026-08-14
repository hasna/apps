// Cryptolens Connector — Software licensing and key management
import { CryptolensClient } from './client';
import type { CryptolensConfig, CLKey, CLProduct, CLCustomer, CLActivateResult } from '../types';
export { CryptolensClient } from './client';

export class Cryptolens {
  private readonly client: CryptolensClient;
  constructor(config: CryptolensConfig) { this.client = new CryptolensClient(config); }
  static fromEnv(): Cryptolens {
    const token = process.env.CRYPTOLENS_TOKEN;
    if (!token) throw new Error('CRYPTOLENS_TOKEN is required');
    return new Cryptolens({ token });
  }

  async activate(productId: number, key: string, machineCode: string): Promise<CLActivateResult> {
    return this.client.request<CLActivateResult>('/key/Activate', { ProductId: productId, Key: key, MachineCode: machineCode, Sign: true });
  }
  async deactivate(productId: number, key: string, machineCode: string): Promise<{ result: number; message: string }> {
    return this.client.request('/key/Deactivate', { ProductId: productId, Key: key, MachineCode: machineCode });
  }
  async createKey(productId: number, options?: { period?: number; f1?: boolean; f2?: boolean; maxNoOfMachines?: number; notes?: string }): Promise<{ key: string; result: number }> {
    return this.client.request('/key/CreateKey', { ProductId: productId, Period: options?.period, F1: options?.f1, F2: options?.f2, MaxNoOfMachines: options?.maxNoOfMachines, Notes: options?.notes });
  }
  async getKey(productId: number, key: string): Promise<CLActivateResult> {
    return this.client.request<CLActivateResult>('/key/GetKey', { ProductId: productId, Key: key, Sign: true });
  }
  async blockKey(productId: number, key: string): Promise<{ result: number }> {
    return this.client.request('/key/BlockKey', { ProductId: productId, Key: key });
  }
  async unblockKey(productId: number, key: string): Promise<{ result: number }> {
    return this.client.request('/key/UnblockKey', { ProductId: productId, Key: key });
  }

  async listProducts(): Promise<{ products: CLProduct[] }> { return this.client.request('/product/GetProducts'); }
  async listCustomers(): Promise<{ customers: CLCustomer[] }> { return this.client.request('/customer/GetCustomers'); }
  async addCustomer(name: string, email: string, companyName?: string): Promise<{ customerId: number }> {
    return this.client.request('/customer/AddCustomer', { Name: name, Email: email, CompanyName: companyName });
  }

  getClient(): CryptolensClient { return this.client; }
}
