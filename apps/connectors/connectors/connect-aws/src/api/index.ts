import type { AWSConfig } from '../types';
import { AWSClient } from './client';
import { S3Api } from './s3';
import { LambdaApi } from './lambda';
import { DynamoDBApi } from './dynamodb';

/**
 * Main AWS Connector class
 * Provides access to S3, Lambda, and DynamoDB services
 */
export class AWS {
  private readonly client: AWSClient;

  // Service APIs
  public readonly s3: S3Api;
  public readonly lambda: LambdaApi;
  public readonly dynamodb: DynamoDBApi;

  constructor(config: AWSConfig) {
    this.client = new AWSClient(config);
    this.s3 = new S3Api(this.client);
    this.lambda = new LambdaApi(this.client);
    this.dynamodb = new DynamoDBApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and optionally AWS_REGION, AWS_SESSION_TOKEN
   */
  static fromEnv(): AWS {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    if (!accessKeyId) {
      throw new Error('AWS_ACCESS_KEY_ID environment variable is required');
    }
    if (!secretAccessKey) {
      throw new Error('AWS_SECRET_ACCESS_KEY environment variable is required');
    }

    return new AWS({ accessKeyId, secretAccessKey, region, sessionToken });
  }

  /**
   * Get a preview of the access key (for debugging)
   */
  getAccessKeyPreview(): string {
    return this.client.getAccessKeyPreview();
  }

  /**
   * Get current region
   */
  getRegion(): string {
    return this.client.getRegion();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): AWSClient {
    return this.client;
  }
}

export { AWSClient } from './client';
export { S3Api } from './s3';
export { LambdaApi } from './lambda';
export { DynamoDBApi } from './dynamodb';
