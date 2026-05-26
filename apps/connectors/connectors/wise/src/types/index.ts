// Wise Connector Types
// International money transfers, multi-currency accounts, and exchange rates

// ============================================
// Configuration
// ============================================

export interface WiseConfig {
  apiKey: string;
  baseUrl?: string; // sandbox or production
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface Money {
  value: number;
  currency: string;
}

// ============================================
// Profile Types
// ============================================

export interface WiseProfile {
  id: number;
  type: 'PERSONAL' | 'BUSINESS';
  details: ProfileDetails;
}

export interface ProfileDetails {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  phoneNumber?: string;
  avatar?: string;
  occupation?: string;
  occupations?: string[];
  primaryAddress?: number;
  name?: string; // For business profiles
  registrationNumber?: string;
  companyType?: string;
  companyRole?: string;
  descriptionOfBusiness?: string;
  webpage?: string;
  acn?: string;
  abn?: string;
  arbn?: string;
}

// ============================================
// Balance Types
// ============================================

export interface Balance {
  id: number;
  currency: string;
  amount: Money;
  reservedAmount?: Money;
  cashAmount?: Money;
  totalWorth?: Money;
  type: 'STANDARD' | 'SAVINGS';
  name?: string;
  icon?: BalanceIcon;
  creationTime?: string;
  modificationTime?: string;
  visible?: boolean;
  bankDetails?: BankDetails;
}

export interface BalanceIcon {
  name: string;
  backgroundColor: string;
}

export interface BankDetails {
  id?: number;
  currency?: string;
  bankCode?: string;
  accountNumber?: string;
  swift?: string;
  iban?: string;
  bankName?: string;
  bankAddress?: {
    addressFirstLine: string;
    postCode: string;
    city: string;
    country: string;
    stateCode?: string;
  };
}

export interface BalancesResponse {
  balances: Balance[];
}

// ============================================
// Quote Types
// ============================================

export interface Quote {
  id: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: number;
  targetAmount?: number;
  payOut: string;
  rate: number;
  createdTime: string;
  user: number;
  profile: number;
  rateType: 'FIXED' | 'FLOATING';
  rateExpirationTime: string;
  paymentOptions: PaymentOption[];
  status: 'PENDING' | 'ACCEPTED' | 'FUNDED' | 'EXPIRED';
  expirationTime: string;
  notices?: QuoteNotice[];
}

export interface PaymentOption {
  disabled: boolean;
  estimatedDelivery: string;
  formattedEstimatedDelivery: string;
  estimatedDeliveryDelays: unknown[];
  fee: PaymentFee;
  sourceAmount: number;
  targetAmount: number;
  sourceCurrency: string;
  targetCurrency: string;
  payIn: string;
  payOut: string;
  allowedProfileTypes: string[];
  payInProduct: string;
  feePercentage: number;
}

export interface PaymentFee {
  transferwise: number;
  payIn: number;
  discount: number;
  partner: number;
  total: number;
}

export interface QuoteNotice {
  text: string;
  link?: string;
  type: string;
}

export interface CreateQuoteRequest {
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount?: number;
  targetAmount?: number;
  targetAccount?: number;
  payOut?: string;
  preferredPayIn?: string;
}

// ============================================
// Recipient Types
// ============================================

export interface Recipient {
  id: number;
  business?: number;
  profile: number;
  accountHolderName: string;
  type: string;
  country: string;
  currency: string;
  details: RecipientDetails;
  isActive: boolean;
  ownedByCustomer: boolean;
}

export interface RecipientDetails {
  address?: RecipientAddress;
  email?: string;
  legalType?: 'PRIVATE' | 'BUSINESS';
  accountNumber?: string;
  sortCode?: string;
  abartn?: string;
  accountType?: string;
  bankgiroNumber?: string;
  ifscCode?: string;
  bsbCode?: string;
  institutionNumber?: string;
  transitNumber?: string;
  phoneNumber?: string;
  bankCode?: string;
  russiaRegion?: string;
  routingNumber?: string;
  branchCode?: string;
  cpf?: string;
  cardNumber?: string;
  idType?: string;
  idNumber?: string;
  idCountryIso3?: string;
  idValidFrom?: string;
  idValidTo?: string;
  clabe?: string;
  swiftCode?: string;
  dateOfBirth?: string;
  clearingNumber?: string;
  bankName?: string;
  branchName?: string;
  businessNumber?: string;
  province?: string;
  city?: string;
  rut?: string;
  token?: string;
  cnpj?: string;
  payinReference?: string;
  pspReference?: string;
  orderId?: string;
  idDocumentType?: string;
  idDocumentNumber?: string;
  targetProfile?: number;
  targetUserId?: number;
  taxId?: string;
  job?: string;
  nationality?: string;
  interacAccount?: string;
  bban?: string;
  IBAN?: string;
  iban?: string;
  BIC?: string;
  bic?: string;
}

export interface RecipientAddress {
  country?: string;
  countryCode?: string;
  firstLine?: string;
  postCode?: string;
  city?: string;
  state?: string;
}

export interface CreateRecipientRequest {
  currency: string;
  type: string;
  profile: number;
  accountHolderName: string;
  ownedByCustomer?: boolean;
  details: Partial<RecipientDetails>;
}

// ============================================
// Transfer Types
// ============================================

export interface Transfer {
  id: number;
  user: number;
  targetAccount: number;
  sourceAccount?: number;
  quote: number;
  quoteUuid?: string;
  status: TransferStatus;
  reference?: string;
  rate: number;
  created: string;
  business?: number;
  transferRequest?: number;
  details: TransferDetails;
  hasActiveIssues: boolean;
  sourceCurrency: string;
  sourceValue: number;
  targetCurrency: string;
  targetValue: number;
  customerTransactionId?: string;
}

export type TransferStatus =
  | 'incoming_payment_waiting'
  | 'incoming_payment_initiated'
  | 'processing'
  | 'funds_converted'
  | 'outgoing_payment_sent'
  | 'cancelled'
  | 'funds_refunded'
  | 'bounced_back'
  | 'charged_back'
  | 'unknown';

export interface TransferDetails {
  reference?: string;
  transferPurpose?: string;
  transferPurposeSubTransferPurpose?: string;
  sourceOfFunds?: string;
}

export interface CreateTransferRequest {
  targetAccount: number;
  quoteUuid: string;
  customerTransactionId: string;
  details?: TransferDetails;
}

export interface FundTransferRequest {
  type: 'BALANCE';
}

// ============================================
// Exchange Rate Types
// ============================================

export interface ExchangeRate {
  rate: number;
  source: string;
  target: string;
  time: string;
}

// ============================================
// Currency Types
// ============================================

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  countryKeywords: string[];
}

// ============================================
// API Error Types
// ============================================

export interface WiseError {
  code: string;
  message: string;
  path?: string;
  arguments?: unknown[];
}

export class WiseApiError extends Error {
  public readonly statusCode: number;
  public readonly errors?: WiseError[];

  constructor(message: string, statusCode: number, errors?: WiseError[]) {
    super(message);
    this.name = 'WiseApiError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
