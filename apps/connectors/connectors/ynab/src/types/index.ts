// YNAB Connector Types
// https://api.ynab.com — amounts are in milliunits (1/1000 of currency unit)

// ============================================
// Configuration
// ============================================

export interface YnabConfig {
  accessToken: string;
  baseUrl?: string;
}

export type OutputFormat = 'json' | 'pretty';

// ============================================
// API Response Wrappers
// ============================================

export interface YnabDataResponse<T> {
  data: T;
}

export interface YnabErrorDetail {
  id: string;
  name: string;
  detail: string;
}

export interface YnabErrorResponse {
  error: YnabErrorDetail;
}

// ============================================
// User
// ============================================

export interface User {
  id: string;
}

// ============================================
// Plans
// ============================================

export interface PlanSummary {
  id: string;
  name: string;
  last_modified_on: string;
  first_month: string;
  last_month: string;
  date_format: { format: string } | null;
  currency_format: CurrencyFormat | null;
  accounts?: Account[];
}

export interface CurrencyFormat {
  iso_code: string;
  example_format: string;
  decimal_digits: number;
  decimal_separator: string;
  symbol_first: boolean;
  group_separator: string;
  currency_symbol: string;
  display_symbol: boolean;
}

export interface PlanDetail extends PlanSummary {
  accounts: Account[];
  payees: Payee[];
  payee_locations: PayeeLocation[];
  category_groups: CategoryGroup[];
  categories: Category[];
  money_movements: MoneyMovement[];
  transactions: Transaction[];
  subtransactions: SubTransaction[];
  scheduled_transactions: ScheduledTransaction[];
  scheduled_subtransactions: ScheduledSubTransaction[];
  months: MonthSummary[];
  deleted_ids?: string[];
}

export interface PlanSettings {
  date_format: { format: string } | null;
  currency_format: CurrencyFormat | null;
}

// ============================================
// Accounts
// ============================================

export type AccountType = 'checking' | 'savings' | 'cash' | 'creditCard' | 'lineOfCredit' | 'merchantAccount' | 'payPal' | 'investment' | 'mortgage' | 'otherAsset' | 'otherLiability';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  on_budget: boolean;
  closed: boolean;
  note: string | null;
  balance: number;
  cleared_balance: number;
  uncleared_balance: number;
  transfer_payee_id: string;
  deleted: boolean;
}

// ============================================
// Categories
// ============================================

export interface CategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
}

export interface Category {
  id: string;
  category_group_id: string;
  category_group_name?: string;
  name: string;
  hidden: boolean;
  original_category_group_id?: string | null;
  note: string | null;
  budgeted: number;
  activity: number;
  balance: number;
  goal_type: string | null;
  goal_creation_month: string | null;
  goal_target: number | null;
  goal_target_month: string | null;
  goal_percentage_complete: number | null;
  goal_months_to_budget: number | null;
  goal_under_funded: number | null;
  goal_overall_funded: number | null;
  goal_overall_left: number | null;
  deleted: boolean;
}

// ============================================
// Transactions
// ============================================

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  memo: string | null;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  approved: boolean;
  flag_color: string | null;
  account_id: string;
  payee_id: string | null;
  category_id: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  matched_transaction_id: string | null;
  import_id: string | null;
  import_payee_name: string | null;
  import_payee_name_original: string | null;
  debt_transaction_type: string | null;
  deleted: boolean;
  subtransactions?: SubTransaction[];
}

export interface SubTransaction {
  id: string;
  transaction_id: string;
  amount: number;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  deleted: boolean;
}

export interface NewTransaction {
  account_id: string;
  date: string;
  amount: number;
  payee_id?: string | null;
  payee_name?: string | null;
  category_id?: string | null;
  memo?: string | null;
  cleared?: 'cleared' | 'uncleared' | 'reconciled';
  approved?: boolean;
  flag_color?: string | null;
  import_id?: string | null;
}

export interface SaveTransaction {
  id?: string;
  account_id?: string;
  date?: string;
  amount?: number;
  payee_id?: string | null;
  payee_name?: string | null;
  category_id?: string | null;
  memo?: string | null;
  cleared?: 'cleared' | 'uncleared' | 'reconciled';
  approved?: boolean;
  flag_color?: string | null;
  deleted?: boolean;
}

// ============================================
// Months
// ============================================

export interface MonthSummary {
  month: string;
  note: string | null;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money: number | null;
  deleted: boolean;
}

// ============================================
// Payees
// ============================================

export interface Payee {
  id: string;
  name: string;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface PayeeLocation {
  id: string;
  payee_id: string;
  latitude: number;
  longitude: number;
  deleted: boolean;
}

// ============================================
// Scheduled Transactions
// ============================================

export interface ScheduledTransaction {
  id: string;
  date_first: string;
  date_next: string;
  frequency: string;
  amount: number;
  memo: string | null;
  flag_color: string | null;
  account_id: string;
  payee_id: string | null;
  category_id: string | null;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface ScheduledSubTransaction {
  id: string;
  scheduled_transaction_id: string;
  amount: number;
  memo: string | null;
  payee_id: string | null;
  category_id: string | null;
  transfer_account_id: string | null;
  deleted: boolean;
}

// ============================================
// Money Movements
// ============================================

export interface MoneyMovement {
  id: string;
  month: string;
  amount: number;
  deleted: boolean;
}

// ============================================
// List Options
// ============================================

export interface ListTransactionsOptions {
  since_date?: string;
  until_date?: string;
  type?: 'uncategorized' | 'unapproved';
  last_knowledge_of_server?: number;
}

export interface SyncOptions {
  last_knowledge_of_server?: number;
}

// ============================================
// API Error
// ============================================

export class YnabApiError extends Error {
  public readonly statusCode: number;
  public readonly error?: YnabErrorDetail;

  constructor(message: string, statusCode: number, error?: YnabErrorDetail) {
    super(message);
    this.name = 'YnabApiError';
    this.statusCode = statusCode;
    this.error = error;
  }
}
