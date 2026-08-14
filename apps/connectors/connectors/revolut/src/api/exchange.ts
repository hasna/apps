import type { RevolutExchangeRate, ExchangeRequest, RevolutExchangeResult } from '../types';
import type { RevolutClient } from './client';

/**
 * Revolut Exchange API
 */
export class ExchangeApi {
  constructor(private readonly client: RevolutClient) {}

  /**
   * Get exchange rate between two currencies
   */
  async getRate(from: string, to: string, amount?: number): Promise<RevolutExchangeRate> {
    const response = await this.client.request<{
      from: { currency: string; amount?: number };
      to: { currency: string; amount: number };
      rate: number;
      fee?: { currency: string; amount: number };
    }>('/rate', {
      params: {
        from,
        to,
        amount,
      },
    });

    return {
      from: response.from.currency,
      to: response.to.currency,
      rate: response.rate,
      fee: response.fee?.amount,
    };
  }

  /**
   * Exchange currency
   */
  async exchange(data: ExchangeRequest): Promise<RevolutExchangeResult> {
    return this.client.request<RevolutExchangeResult>('/exchange', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * Get supported exchange currencies
   * Note: This lists all account currencies which can be exchanged
   */
  async getSupportedCurrencies(): Promise<string[]> {
    // Revolut supports these common currencies for exchange
    // This is a convenience method - actual availability depends on account setup
    return [
      'AED', 'AUD', 'BGN', 'CAD', 'CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
      'HRK', 'HUF', 'ILS', 'INR', 'ISK', 'JPY', 'MAD', 'MXN', 'NOK', 'NZD',
      'PLN', 'QAR', 'RON', 'RSD', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY',
      'USD', 'ZAR'
    ];
  }

  /**
   * Exchange with a simple interface
   */
  async quickExchange(
    fromAccountId: string,
    toAccountId: string,
    fromCurrency: string,
    toCurrency: string,
    amount: number,
    reference?: string
  ): Promise<RevolutExchangeResult> {
    const requestId = `exch_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return this.exchange({
      request_id: requestId,
      from: {
        account_id: fromAccountId,
        currency: fromCurrency,
        amount,
      },
      to: {
        account_id: toAccountId,
        currency: toCurrency,
      },
      reference,
    });
  }
}
