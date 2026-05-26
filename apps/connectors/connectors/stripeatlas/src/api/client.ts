import type { StripeAtlasConfig, OutputFormat } from '../types';
import { StripeAtlasApiError } from '../types';

// Stripe Atlas dashboard URL
const STRIPE_ATLAS_URL = 'https://atlas.stripe.com';

export interface RequestOptions {
  format?: OutputFormat;
}

/**
 * Stripe Atlas Client
 * Uses browser automation since Stripe Atlas doesn't have a public API
 */
export class StripeAtlasClient {
  private readonly email: string;
  private readonly password?: string;
  private readonly baseUrl: string;

  constructor(config: StripeAtlasConfig) {
    if (!config.email) {
      throw new Error('Email is required for Stripe Atlas authentication');
    }
    this.email = config.email;
    this.password = config.password;
    this.baseUrl = config.baseUrl || STRIPE_ATLAS_URL;
  }

  /**
   * Get the Stripe Atlas dashboard URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Get the configured email
   */
  getEmail(): string {
    return this.email;
  }

  /**
   * Check if password is configured
   */
  hasPassword(): boolean {
    return !!this.password;
  }

  /**
   * Get the password (for browser automation)
   */
  getPassword(): string | undefined {
    return this.password;
  }

  /**
   * Get a preview of the email (for display/debugging)
   */
  getEmailPreview(): string {
    if (this.email.includes('@')) {
      const [local, domain] = this.email.split('@');
      if (local.length > 3) {
        return `${local.substring(0, 3)}...@${domain}`;
      }
    }
    return this.email;
  }

  // Alias for backwards compatibility
  getApiKeyPreview(): string {
    return this.getEmailPreview();
  }
}

// Export alias for backwards compatibility with scaffold patterns
export { StripeAtlasClient as ConnectorClient };
