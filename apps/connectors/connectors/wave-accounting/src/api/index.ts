// Wave Accounting Connector
// GraphQL API for businesses, invoices, customers, and accounts

import { WaveGraphQLClient } from './client';
import type {
  WaveAccountingConfig,
  Business,
  BusinessConnection,
  Customer,
  CustomerConnection,
  Invoice,
  InvoiceConnection,
  Account,
  AccountConnection,
  InvoiceCreateInput,
  InvoiceCreateOutput,
  ListBusinessesOptions,
  ListCustomersOptions,
  ListInvoicesOptions,
  ListAccountsOptions,
} from '../types';
import { WaveApiError } from '../types';

export { WaveGraphQLClient } from './client';

const BUSINESS_FIELDS = `
  id
  name
  isPersonal
  isArchived
  createdAt
  modifiedAt
  timezone
  website
  currency { code name symbol }
`;

const CUSTOMER_FIELDS = `
  id
  name
  email
  firstName
  lastName
  phone
  displayId
  isArchived
  createdAt
  modifiedAt
`;

const INVOICE_FIELDS = `
  id
  status
  title
  invoiceNumber
  invoiceDate
  dueDate
  createdAt
  modifiedAt
  pdfUrl
  viewUrl
  amountDue { raw value }
  amountPaid { raw value }
  total { raw value }
  currency { code name symbol }
  customer { id name email }
`;

const ACCOUNT_FIELDS = `
  id
  name
  description
  isArchived
  subtype { name value }
  type { name value }
`;

export class WaveAccounting {
  private client: WaveGraphQLClient;

  constructor(config: WaveAccountingConfig) {
    this.client = new WaveGraphQLClient(config);
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.client.query<T>(query, variables);
  }

  async listBusinesses(options?: ListBusinessesOptions): Promise<Business[]> {
    const query = `
      query($page: Int, $pageSize: Int, $isArchived: Boolean) {
        businesses(page: $page, pageSize: $pageSize, isArchived: $isArchived) {
          edges { node { ${BUSINESS_FIELDS} } }
          pageInfo { currentPage totalPages totalCount }
        }
      }
    `;
    const result = await this.client.query<{ businesses: BusinessConnection }>(query, {
      page: options?.page,
      pageSize: options?.pageSize,
      isArchived: options?.isArchived,
    });
    return result.businesses.edges.map(edge => edge.node);
  }

  async getBusiness(id?: string): Promise<Business | null> {
    const query = `
      query($id: ID) {
        business(id: $id) {
          ${BUSINESS_FIELDS}
        }
      }
    `;
    const result = await this.client.query<{ business: Business | null }>(query, { id });
    return result.business;
  }

  async listCustomers(businessId: string, options?: ListCustomersOptions): Promise<Customer[]> {
    const query = `
      query($businessId: ID!, $page: Int, $pageSize: Int, $email: String) {
        business(id: $businessId) {
          customers(page: $page, pageSize: $pageSize, email: $email) {
            edges { node { ${CUSTOMER_FIELDS} } }
            pageInfo { currentPage totalPages totalCount }
          }
        }
      }
    `;
    const result = await this.client.query<{
      business: { customers: CustomerConnection } | null;
    }>(query, {
      businessId,
      page: options?.page,
      pageSize: options?.pageSize,
      email: options?.email,
    });

    if (!result.business) {
      throw new WaveApiError(`Business not found: ${businessId}`);
    }

    return result.business.customers.edges.map(edge => edge.node);
  }

  async getCustomer(businessId: string, customerId: string): Promise<Customer | null> {
    const query = `
      query($businessId: ID!, $customerId: ID!) {
        business(id: $businessId) {
          customer(id: $customerId) {
            ${CUSTOMER_FIELDS}
          }
        }
      }
    `;
    const result = await this.client.query<{
      business: { customer: Customer | null } | null;
    }>(query, { businessId, customerId });

    return result.business?.customer ?? null;
  }

  async listInvoices(businessId: string, options?: ListInvoicesOptions): Promise<Invoice[]> {
    const query = `
      query($businessId: ID!, $page: Int, $pageSize: Int, $status: InvoiceStatus, $customerId: ID) {
        business(id: $businessId) {
          invoices(page: $page, pageSize: $pageSize, status: $status, customerId: $customerId) {
            edges { node { ${INVOICE_FIELDS} } }
            pageInfo { currentPage totalPages totalCount }
          }
        }
      }
    `;
    const result = await this.client.query<{
      business: { invoices: InvoiceConnection } | null;
    }>(query, {
      businessId,
      page: options?.page,
      pageSize: options?.pageSize,
      status: options?.status,
      customerId: options?.customerId,
    });

    if (!result.business) {
      throw new WaveApiError(`Business not found: ${businessId}`);
    }

    return result.business.invoices.edges.map(edge => edge.node);
  }

  async getInvoice(businessId: string, invoiceId: string): Promise<Invoice | null> {
    const query = `
      query($businessId: ID!, $invoiceId: ID!) {
        business(id: $businessId) {
          invoice(id: $invoiceId) {
            ${INVOICE_FIELDS}
          }
        }
      }
    `;
    const result = await this.client.query<{
      business: { invoice: Invoice | null } | null;
    }>(query, { businessId, invoiceId });

    return result.business?.invoice ?? null;
  }

  async createInvoice(input: InvoiceCreateInput): Promise<Invoice> {
    const mutation = `
      mutation($input: InvoiceCreateInput!) {
        invoiceCreate(input: $input) {
          didSucceed
          inputErrors { path message code }
          invoice { ${INVOICE_FIELDS} }
        }
      }
    `;
    const result = await this.client.mutation<InvoiceCreateOutput>(mutation, { input });

    const output = result.invoiceCreate;
    if (!output.didSucceed || !output.invoice) {
      const messages = output.inputErrors?.map(e => e.message).join('; ') || 'Invoice creation failed';
      throw new WaveApiError(messages);
    }

    return output.invoice;
  }

  async listAccounts(businessId: string, options?: ListAccountsOptions): Promise<Account[]> {
    const query = `
      query($businessId: ID!, $page: Int, $pageSize: Int, $isArchived: Boolean) {
        business(id: $businessId) {
          accounts(page: $page, pageSize: $pageSize, isArchived: $isArchived) {
            edges { node { ${ACCOUNT_FIELDS} } }
            pageInfo { currentPage totalPages totalCount }
          }
        }
      }
    `;
    const result = await this.client.query<{
      business: { accounts: AccountConnection } | null;
    }>(query, {
      businessId,
      page: options?.page,
      pageSize: options?.pageSize,
      isArchived: options?.isArchived,
    });

    if (!result.business) {
      throw new WaveApiError(`Business not found: ${businessId}`);
    }

    return result.business.accounts.edges.map(edge => edge.node);
  }

  getClient(): WaveGraphQLClient {
    return this.client;
  }
}
