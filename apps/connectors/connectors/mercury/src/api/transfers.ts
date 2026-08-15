import type { MercuryClient } from './client';
import type {
  Transfer,
  TransferListResponse,
  TransferCreateParams,
  TransferListParams,
} from '../types';

/**
 * Mercury Transfers API
 * Send and manage transfers
 */
export class TransfersApi {
  constructor(private readonly client: MercuryClient) {}

  /**
   * List transfers for an account
   */
  async list(accountId: string, params?: TransferListParams): Promise<TransferListResponse> {
    return this.client.get<TransferListResponse>(`/account/${accountId}/transfers`, {
      limit: params?.limit,
      offset: params?.offset,
      status: params?.status,
      recipientId: params?.recipientId,
    });
  }

  /**
   * Get a single transfer
   */
  async get(accountId: string, transferId: string): Promise<Transfer> {
    return this.client.get<Transfer>(`/account/${accountId}/transfers/${transferId}`);
  }

  /**
   * Create a new transfer (send money)
   */
  async create(params: TransferCreateParams): Promise<Transfer> {
    return this.client.post<Transfer>(`/account/${params.accountId}/transfers`, {
      recipientId: params.recipientId,
      amount: params.amount,
      paymentMethod: params.paymentMethod,
      idempotencyKey: params.idempotencyKey,
      externalMemo: params.externalMemo,
      note: params.note,
    });
  }

  /**
   * Cancel a pending transfer
   */
  async cancel(accountId: string, transferId: string): Promise<Transfer> {
    return this.client.delete<Transfer>(`/account/${accountId}/transfers/${transferId}`);
  }

  /**
   * Create an internal transfer between Mercury accounts
   */
  async createInternal(params: {
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    idempotencyKey?: string;
    note?: string;
  }): Promise<Transfer> {
    return this.client.post<Transfer>(`/account/${params.fromAccountId}/internal-transfers`, {
      toAccountId: params.toAccountId,
      amount: params.amount,
      idempotencyKey: params.idempotencyKey,
      note: params.note,
    });
  }

  /**
   * Request to send money (queued for admin approval)
   * Use this when API token doesn't have IP whitelist configured
   */
  async requestSendMoney(params: TransferCreateParams): Promise<Transfer> {
    return this.client.post<Transfer>('/request-send-money', {
      accountId: params.accountId,
      recipientId: params.recipientId,
      amount: params.amount,
      paymentMethod: params.paymentMethod,
      idempotencyKey: params.idempotencyKey,
      externalMemo: params.externalMemo,
      note: params.note,
    });
  }

  /**
   * Get a send money approval request by ID
   */
  async getSendMoneyRequest(requestId: string): Promise<Transfer> {
    return this.client.get<Transfer>(`/request-send-money/${requestId}`);
  }
}
