// AWS Connector Types

// ============================================
// Configuration
// ============================================

export interface AWSConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
}

// ============================================
// Common Types
// ============================================

export type OutputFormat = 'json' | 'pretty';

export interface PaginatedResponse<T> {
  data: T[];
  nextToken?: string;
  hasMore: boolean;
}

// ============================================
// S3 Types
// ============================================

export interface S3Bucket {
  name: string;
  creationDate?: string;
}

export interface S3Object {
  key: string;
  lastModified?: string;
  eTag?: string;
  size?: number;
  storageClass?: string;
  owner?: {
    displayName?: string;
    id?: string;
  };
}

export interface S3ListObjectsResponse {
  name: string;
  prefix?: string;
  contents: S3Object[];
  commonPrefixes?: { prefix: string }[];
  isTruncated: boolean;
  nextContinuationToken?: string;
  keyCount?: number;
}

export interface S3PutObjectRequest {
  bucket: string;
  key: string;
  body: string | Buffer | Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
  acl?: 'private' | 'public-read' | 'public-read-write' | 'authenticated-read';
}

export interface S3GetObjectResponse {
  body: Uint8Array;
  contentType?: string;
  contentLength?: number;
  lastModified?: string;
  eTag?: string;
  metadata?: Record<string, string>;
}

export interface S3HeadObjectResponse {
  contentType?: string;
  contentLength?: number;
  lastModified?: string;
  eTag?: string;
  metadata?: Record<string, string>;
}

// ============================================
// Lambda Types
// ============================================

export interface LambdaFunction {
  functionName: string;
  functionArn?: string;
  runtime?: string;
  role?: string;
  handler?: string;
  codeSize?: number;
  description?: string;
  timeout?: number;
  memorySize?: number;
  lastModified?: string;
  version?: string;
  state?: string;
  stateReason?: string;
  stateReasonCode?: string;
  packageType?: 'Zip' | 'Image';
  architectures?: string[];
}

export interface LambdaListFunctionsResponse {
  functions: LambdaFunction[];
  nextMarker?: string;
}

export interface LambdaInvokeRequest {
  functionName: string;
  payload?: unknown;
  invocationType?: 'RequestResponse' | 'Event' | 'DryRun';
  logType?: 'None' | 'Tail';
  qualifier?: string;
}

export interface LambdaInvokeResponse {
  statusCode: number;
  functionError?: string;
  logResult?: string;
  payload?: unknown;
  executedVersion?: string;
}

export interface LambdaFunctionConfiguration extends LambdaFunction {
  environment?: {
    variables?: Record<string, string>;
  };
  layers?: {
    arn: string;
    codeSize?: number;
  }[];
  vpcConfig?: {
    subnetIds?: string[];
    securityGroupIds?: string[];
    vpcId?: string;
  };
}

// ============================================
// DynamoDB Types
// ============================================

export type DynamoDBAttributeValue =
  | { S: string }
  | { N: string }
  | { B: string }
  | { SS: string[] }
  | { NS: string[] }
  | { BS: string[] }
  | { M: Record<string, DynamoDBAttributeValue> }
  | { L: DynamoDBAttributeValue[] }
  | { NULL: boolean }
  | { BOOL: boolean };

export interface DynamoDBItem {
  [key: string]: DynamoDBAttributeValue;
}

export interface DynamoDBTable {
  tableName: string;
  tableStatus?: 'CREATING' | 'UPDATING' | 'DELETING' | 'ACTIVE' | 'INACCESSIBLE_ENCRYPTION_CREDENTIALS' | 'ARCHIVING' | 'ARCHIVED';
  tableArn?: string;
  tableSizeBytes?: number;
  itemCount?: number;
  creationDateTime?: string;
}

export interface DynamoDBKeySchema {
  attributeName: string;
  keyType: 'HASH' | 'RANGE';
}

export interface DynamoDBAttributeDefinition {
  attributeName: string;
  attributeType: 'S' | 'N' | 'B';
}

export interface DynamoDBTableDescription extends DynamoDBTable {
  keySchema?: DynamoDBKeySchema[];
  attributeDefinitions?: DynamoDBAttributeDefinition[];
  provisionedThroughput?: {
    readCapacityUnits?: number;
    writeCapacityUnits?: number;
  };
  billingModeSummary?: {
    billingMode?: 'PROVISIONED' | 'PAY_PER_REQUEST';
  };
  globalSecondaryIndexes?: {
    indexName: string;
    keySchema: DynamoDBKeySchema[];
    projection: {
      projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
    };
    indexStatus?: string;
    itemCount?: number;
  }[];
  localSecondaryIndexes?: {
    indexName: string;
    keySchema: DynamoDBKeySchema[];
    projection: {
      projectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
    };
    itemCount?: number;
  }[];
}

export interface DynamoDBQueryRequest {
  tableName: string;
  keyConditionExpression: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: DynamoDBItem;
  filterExpression?: string;
  projectionExpression?: string;
  limit?: number;
  scanIndexForward?: boolean;
  exclusiveStartKey?: DynamoDBItem;
  indexName?: string;
  select?: 'ALL_ATTRIBUTES' | 'ALL_PROJECTED_ATTRIBUTES' | 'SPECIFIC_ATTRIBUTES' | 'COUNT';
  consistentRead?: boolean;
}

export interface DynamoDBScanRequest {
  tableName: string;
  filterExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: DynamoDBItem;
  projectionExpression?: string;
  limit?: number;
  exclusiveStartKey?: DynamoDBItem;
  indexName?: string;
  select?: 'ALL_ATTRIBUTES' | 'ALL_PROJECTED_ATTRIBUTES' | 'SPECIFIC_ATTRIBUTES' | 'COUNT';
  consistentRead?: boolean;
  segment?: number;
  totalSegments?: number;
}

export interface DynamoDBQueryResponse {
  items: DynamoDBItem[];
  count: number;
  scannedCount: number;
  lastEvaluatedKey?: DynamoDBItem;
}

export interface DynamoDBScanResponse {
  items: DynamoDBItem[];
  count: number;
  scannedCount: number;
  lastEvaluatedKey?: DynamoDBItem;
}

// ============================================
// API Error Types
// ============================================

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
}

export class AWSApiError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly requestId?: string;

  constructor(message: string, statusCode: number, code?: string, requestId?: string) {
    super(message);
    this.name = 'AWSApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}
