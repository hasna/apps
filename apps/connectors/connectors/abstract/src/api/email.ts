import type { ConnectorClient } from './client';
import type { EmailValidationParams, EmailValidationResult } from '../types';

const BASE_URL = 'https://emailvalidation.abstractapi.com';

export class EmailApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Validate an email address.
   * Returns deliverability info, format validation, and more.
   */
  async validate(params: EmailValidationParams): Promise<EmailValidationResult> {
    const queryParams: Record<string, string | number | boolean | undefined> = {
      email: params.email,
    };

    if (params.auto_correct !== undefined) {
      queryParams.auto_correct = params.auto_correct;
    }

    return this.client.get<EmailValidationResult>('/v1/', queryParams, BASE_URL);
  }
}
