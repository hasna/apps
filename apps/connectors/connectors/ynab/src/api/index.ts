import type {
  YnabConfig,
  YnabDataResponse,
  User,
  PlanSummary,
  PlanDetail,
  PlanSettings,
  Account,
  Category,
  Transaction,
  NewTransaction,
  SaveTransaction,
  MonthSummary,
  Payee,
  ScheduledTransaction,
  ListTransactionsOptions,
  SyncOptions,
} from '../types';
import { YnabClient } from './client';

/**
 * YNAB Connector
 * You Need A Budget — personal finance and budgeting API
 */
export class Ynab {
  private readonly client: YnabClient;

  constructor(config: YnabConfig) {
    this.client = new YnabClient(config);
  }

  static fromEnv(): Ynab {
    const accessToken = process.env.YNAB_ACCESS_TOKEN;
    const baseUrl = process.env.YNAB_BASE_URL;

    if (!accessToken) {
      throw new Error('YNAB_ACCESS_TOKEN environment variable is required');
    }
    return new Ynab({ accessToken, baseUrl });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  getClient(): YnabClient {
    return this.client;
  }

  // ============================================
  // User
  // ============================================

  async getUser(): Promise<User> {
    const response = await this.client.get<YnabDataResponse<{ user: User }>>('/user');
    return response.data.user;
  }

  // ============================================
  // Plans
  // ============================================

  async listPlans(includeAccounts = false): Promise<PlanSummary[]> {
    const response = await this.client.get<YnabDataResponse<{ plans: PlanSummary[] }>>('/plans', {
      include_accounts: includeAccounts || undefined,
    });
    return response.data.plans;
  }

  async getPlan(planId: string, options: SyncOptions = {}): Promise<PlanDetail> {
    const response = await this.client.get<YnabDataResponse<{ plan: PlanDetail }>>(
      `/plans/${planId}`,
      options.last_knowledge_of_server !== undefined
        ? { last_knowledge_of_server: options.last_knowledge_of_server }
        : undefined,
    );
    return response.data.plan;
  }

  async getPlanSettings(planId: string): Promise<PlanSettings> {
    const response = await this.client.get<YnabDataResponse<{ settings: PlanSettings }>>(
      `/plans/${planId}/settings`,
    );
    return response.data.settings;
  }

  // ============================================
  // Accounts
  // ============================================

  async listAccounts(planId: string, options: SyncOptions = {}): Promise<Account[]> {
    const response = await this.client.get<YnabDataResponse<{ accounts: Account[] }>>(
      `/plans/${planId}/accounts`,
      options.last_knowledge_of_server !== undefined
        ? { last_knowledge_of_server: options.last_knowledge_of_server }
        : undefined,
    );
    return response.data.accounts;
  }

  async getAccount(planId: string, accountId: string): Promise<Account> {
    const response = await this.client.get<YnabDataResponse<{ account: Account }>>(
      `/plans/${planId}/accounts/${accountId}`,
    );
    return response.data.account;
  }

  // ============================================
  // Categories
  // ============================================

  async listCategories(planId: string, options: SyncOptions = {}): Promise<Category[]> {
    const response = await this.client.get<YnabDataResponse<{ category_groups: Array<{ categories: Category[] }> }>>(
      `/plans/${planId}/categories`,
      options.last_knowledge_of_server !== undefined
        ? { last_knowledge_of_server: options.last_knowledge_of_server }
        : undefined,
    );
    return response.data.category_groups.flatMap((group) => group.categories);
  }

  async getCategory(planId: string, categoryId: string): Promise<Category> {
    const response = await this.client.get<YnabDataResponse<{ category: Category }>>(
      `/plans/${planId}/categories/${categoryId}`,
    );
    return response.data.category;
  }

  // ============================================
  // Transactions
  // ============================================

  async listTransactions(planId: string, options: ListTransactionsOptions = {}): Promise<Transaction[]> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (options.since_date) params.since_date = options.since_date;
    if (options.until_date) params.until_date = options.until_date;
    if (options.type) params.type = options.type;
    if (options.last_knowledge_of_server !== undefined) {
      params.last_knowledge_of_server = options.last_knowledge_of_server;
    }

    const response = await this.client.get<YnabDataResponse<{ transactions: Transaction[] }>>(
      `/plans/${planId}/transactions`,
      params,
    );
    return response.data.transactions;
  }

  async getTransaction(planId: string, transactionId: string): Promise<Transaction> {
    const response = await this.client.get<YnabDataResponse<{ transaction: Transaction }>>(
      `/plans/${planId}/transactions/${transactionId}`,
    );
    return response.data.transaction;
  }

  async createTransaction(planId: string, transaction: NewTransaction): Promise<Transaction> {
    const response = await this.client.post<YnabDataResponse<{ transaction: Transaction }>>(
      `/plans/${planId}/transactions`,
      { transaction },
    );
    return response.data.transaction;
  }

  async updateTransaction(planId: string, transactionId: string, transaction: SaveTransaction): Promise<Transaction> {
    const response = await this.client.put<YnabDataResponse<{ transaction: Transaction }>>(
      `/plans/${planId}/transactions/${transactionId}`,
      { transaction },
    );
    return response.data.transaction;
  }

  // ============================================
  // Months
  // ============================================

  async listMonths(planId: string): Promise<MonthSummary[]> {
    const response = await this.client.get<YnabDataResponse<{ months: MonthSummary[] }>>(
      `/plans/${planId}/months`,
    );
    return response.data.months;
  }

  async getMonth(planId: string, month: string): Promise<MonthSummary> {
    const response = await this.client.get<YnabDataResponse<{ month: MonthSummary }>>(
      `/plans/${planId}/months/${month}`,
    );
    return response.data.month;
  }

  // ============================================
  // Payees
  // ============================================

  async listPayees(planId: string, options: SyncOptions = {}): Promise<Payee[]> {
    const response = await this.client.get<YnabDataResponse<{ payees: Payee[] }>>(
      `/plans/${planId}/payees`,
      options.last_knowledge_of_server !== undefined
        ? { last_knowledge_of_server: options.last_knowledge_of_server }
        : undefined,
    );
    return response.data.payees;
  }

  async getPayee(planId: string, payeeId: string): Promise<Payee> {
    const response = await this.client.get<YnabDataResponse<{ payee: Payee }>>(
      `/plans/${planId}/payees/${payeeId}`,
    );
    return response.data.payee;
  }

  // ============================================
  // Scheduled Transactions
  // ============================================

  async listScheduledTransactions(planId: string, options: SyncOptions = {}): Promise<ScheduledTransaction[]> {
    const response = await this.client.get<YnabDataResponse<{ scheduled_transactions: ScheduledTransaction[] }>>(
      `/plans/${planId}/scheduled_transactions`,
      options.last_knowledge_of_server !== undefined
        ? { last_knowledge_of_server: options.last_knowledge_of_server }
        : undefined,
    );
    return response.data.scheduled_transactions;
  }

  async getScheduledTransaction(planId: string, scheduledTransactionId: string): Promise<ScheduledTransaction> {
    const response = await this.client.get<YnabDataResponse<{ scheduled_transaction: ScheduledTransaction }>>(
      `/plans/${planId}/scheduled_transactions/${scheduledTransactionId}`,
    );
    return response.data.scheduled_transaction;
  }

  // ============================================
  // Raw request escape hatch
  // ============================================

  async rawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    } = {},
  ): Promise<T> {
    return this.client.request<T>(path, { method, ...options });
  }
}

export { YnabClient, DEFAULT_BASE_URL } from './client';
