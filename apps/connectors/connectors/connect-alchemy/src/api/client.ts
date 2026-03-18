import type { AlchemyConfig, AlchemyJsonRpcResponse } from '../types';
import { AlchemyApiError } from '../types';

export class AlchemyClient {
  private readonly apiKey: string;
  private readonly network: string;
  private readonly baseUrl: string;
  private rpcId = 1;

  constructor(config: AlchemyConfig) {
    if (!config.apiKey) throw new Error('Alchemy apiKey is required');
    this.apiKey = config.apiKey;
    this.network = config.network || 'eth-mainnet';
    this.baseUrl = config.baseUrl || `https://${this.network}.g.alchemy.com/v2/${this.apiKey}`;
  }

  async rpc<T>(method: string, params: unknown[] = []): Promise<AlchemyJsonRpcResponse<T>> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.rpcId++, method, params }),
    });
    if (!response.ok) throw new AlchemyApiError(response.statusText, response.status);
    const data = await response.json() as AlchemyJsonRpcResponse<T>;
    if (data.error) throw new AlchemyApiError(data.error.message, data.error.code);
    return data;
  }

  async nftRequest<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`https://${this.network}.g.alchemy.com/nft/v3/${this.apiKey}${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => { if (v !== undefined) url.searchParams.append(k, String(v)); });
    const response = await fetch(url.toString());
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new AlchemyApiError((data as { message?: string })?.message || response.statusText, response.status);
    }
    return (await response.json()) as T;
  }
}
