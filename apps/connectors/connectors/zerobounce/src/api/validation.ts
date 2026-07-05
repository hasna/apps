import type { ConnectorClient } from './client';
import type {
  ValidateParams,
  ValidateSandboxParams,
  ValidateBatchParams,
  ValidationResult,
  ValidateBatchResult,
} from '../types';

export class ValidationApi {
  constructor(private readonly client: ConnectorClient) {}

  async validate(params: ValidateParams): Promise<ValidationResult> {
    if (!params.email) {
      throw new Error('email is required');
    }

    return this.client.get<ValidationResult>('/v2/validate', {
      email: params.email,
      ip_address: params.ip_address,
      timeout: params.timeout,
      activity_data: params.activity_data,
      verify_plus: params.verify_plus,
    });
  }

  async validateSandbox(params: ValidateSandboxParams): Promise<ValidationResult> {
    if (!params.email) {
      throw new Error('email is required');
    }

    return this.client.get<ValidationResult>('/v2/validate', {
      email: params.email,
      ip_address: params.ip_address,
      timeout: params.timeout,
      activity_data: params.activity_data,
      verify_plus: params.verify_plus,
    });
  }

  async validateBatch(params: ValidateBatchParams): Promise<ValidateBatchResult> {
    if (!params.email_batch?.length) {
      throw new Error('email_batch is required and must not be empty');
    }

    const apiTimeoutSeconds = params.timeout ?? 120;

    return this.client.postJson<ValidateBatchResult>(
      '/v2/validatebatch',
      {
        email_batch: params.email_batch,
        timeout: apiTimeoutSeconds,
        activity_data: params.activity_data,
        verify_plus: params.verify_plus,
      },
      {
        timeout: apiTimeoutSeconds * 1000 + 10000,
      }
    );
  }
}
