import type { AWSClient } from './client';
import type {
  DynamoDBTable,
  DynamoDBTableDescription,
  DynamoDBItem,
  DynamoDBQueryRequest,
  DynamoDBScanRequest,
  DynamoDBQueryResponse,
  DynamoDBScanResponse,
} from '../types';

/**
 * DynamoDB API client
 */
export class DynamoDBApi {
  private readonly client: AWSClient;

  constructor(client: AWSClient) {
    this.client = client;
  }

  /**
   * Make a DynamoDB API request
   */
  private async dynamoRequest<T>(action: string, body: Record<string, unknown>): Promise<T> {
    return this.client.request<T>('/', {
      method: 'POST',
      service: 'dynamodb',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': `DynamoDB_20120810.${action}`,
      },
      body: new TextEncoder().encode(JSON.stringify(body)),
    });
  }

  /**
   * List all DynamoDB tables
   */
  async listTables(options?: {
    exclusiveStartTableName?: string;
    limit?: number;
  }): Promise<{ tableNames: string[]; lastEvaluatedTableName?: string }> {
    const body: Record<string, unknown> = {};

    if (options?.exclusiveStartTableName) {
      body.ExclusiveStartTableName = options.exclusiveStartTableName;
    }
    if (options?.limit) {
      body.Limit = options.limit;
    }

    const response = await this.dynamoRequest<{
      TableNames?: string[];
      LastEvaluatedTableName?: string;
    }>('ListTables', body);

    return {
      tableNames: response.TableNames || [],
      lastEvaluatedTableName: response.LastEvaluatedTableName,
    };
  }

  /**
   * Describe a DynamoDB table
   */
  async describeTable(tableName: string): Promise<DynamoDBTableDescription> {
    const response = await this.dynamoRequest<{
      Table?: {
        TableName?: string;
        TableStatus?: string;
        TableArn?: string;
        TableSizeBytes?: number;
        ItemCount?: number;
        CreationDateTime?: number;
        KeySchema?: Array<{
          AttributeName: string;
          KeyType: 'HASH' | 'RANGE';
        }>;
        AttributeDefinitions?: Array<{
          AttributeName: string;
          AttributeType: 'S' | 'N' | 'B';
        }>;
        ProvisionedThroughput?: {
          ReadCapacityUnits?: number;
          WriteCapacityUnits?: number;
        };
        BillingModeSummary?: {
          BillingMode?: 'PROVISIONED' | 'PAY_PER_REQUEST';
        };
        GlobalSecondaryIndexes?: Array<{
          IndexName: string;
          KeySchema: Array<{
            AttributeName: string;
            KeyType: 'HASH' | 'RANGE';
          }>;
          Projection: {
            ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
          };
          IndexStatus?: string;
          ItemCount?: number;
        }>;
        LocalSecondaryIndexes?: Array<{
          IndexName: string;
          KeySchema: Array<{
            AttributeName: string;
            KeyType: 'HASH' | 'RANGE';
          }>;
          Projection: {
            ProjectionType: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
          };
          ItemCount?: number;
        }>;
      };
    }>('DescribeTable', { TableName: tableName });

    const table = response.Table || {};

    return {
      tableName: table.TableName || tableName,
      tableStatus: table.TableStatus as DynamoDBTableDescription['tableStatus'],
      tableArn: table.TableArn,
      tableSizeBytes: table.TableSizeBytes,
      itemCount: table.ItemCount,
      creationDateTime: table.CreationDateTime ? new Date(table.CreationDateTime * 1000).toISOString() : undefined,
      keySchema: table.KeySchema?.map(k => ({
        attributeName: k.AttributeName,
        keyType: k.KeyType,
      })),
      attributeDefinitions: table.AttributeDefinitions?.map(a => ({
        attributeName: a.AttributeName,
        attributeType: a.AttributeType,
      })),
      provisionedThroughput: table.ProvisionedThroughput ? {
        readCapacityUnits: table.ProvisionedThroughput.ReadCapacityUnits,
        writeCapacityUnits: table.ProvisionedThroughput.WriteCapacityUnits,
      } : undefined,
      billingModeSummary: table.BillingModeSummary ? {
        billingMode: table.BillingModeSummary.BillingMode,
      } : undefined,
      globalSecondaryIndexes: table.GlobalSecondaryIndexes?.map(gsi => ({
        indexName: gsi.IndexName,
        keySchema: gsi.KeySchema.map(k => ({
          attributeName: k.AttributeName,
          keyType: k.KeyType,
        })),
        projection: {
          projectionType: gsi.Projection.ProjectionType,
        },
        indexStatus: gsi.IndexStatus,
        itemCount: gsi.ItemCount,
      })),
      localSecondaryIndexes: table.LocalSecondaryIndexes?.map(lsi => ({
        indexName: lsi.IndexName,
        keySchema: lsi.KeySchema.map(k => ({
          attributeName: k.AttributeName,
          keyType: k.KeyType,
        })),
        projection: {
          projectionType: lsi.Projection.ProjectionType,
        },
        itemCount: lsi.ItemCount,
      })),
    };
  }

  /**
   * Get an item from a table
   */
  async getItem(
    tableName: string,
    key: DynamoDBItem,
    options?: {
      consistentRead?: boolean;
      projectionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
    }
  ): Promise<{ item?: DynamoDBItem }> {
    const body: Record<string, unknown> = {
      TableName: tableName,
      Key: key,
    };

    if (options?.consistentRead !== undefined) {
      body.ConsistentRead = options.consistentRead;
    }
    if (options?.projectionExpression) {
      body.ProjectionExpression = options.projectionExpression;
    }
    if (options?.expressionAttributeNames) {
      body.ExpressionAttributeNames = options.expressionAttributeNames;
    }

    const response = await this.dynamoRequest<{
      Item?: DynamoDBItem;
    }>('GetItem', body);

    return {
      item: response.Item,
    };
  }

  /**
   * Put an item into a table
   */
  async putItem(
    tableName: string,
    item: DynamoDBItem,
    options?: {
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: DynamoDBItem;
      returnValues?: 'NONE' | 'ALL_OLD';
    }
  ): Promise<{ attributes?: DynamoDBItem }> {
    const body: Record<string, unknown> = {
      TableName: tableName,
      Item: item,
    };

    if (options?.conditionExpression) {
      body.ConditionExpression = options.conditionExpression;
    }
    if (options?.expressionAttributeNames) {
      body.ExpressionAttributeNames = options.expressionAttributeNames;
    }
    if (options?.expressionAttributeValues) {
      body.ExpressionAttributeValues = options.expressionAttributeValues;
    }
    if (options?.returnValues) {
      body.ReturnValues = options.returnValues;
    }

    const response = await this.dynamoRequest<{
      Attributes?: DynamoDBItem;
    }>('PutItem', body);

    return {
      attributes: response.Attributes,
    };
  }

  /**
   * Delete an item from a table
   */
  async deleteItem(
    tableName: string,
    key: DynamoDBItem,
    options?: {
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: DynamoDBItem;
      returnValues?: 'NONE' | 'ALL_OLD';
    }
  ): Promise<{ attributes?: DynamoDBItem }> {
    const body: Record<string, unknown> = {
      TableName: tableName,
      Key: key,
    };

    if (options?.conditionExpression) {
      body.ConditionExpression = options.conditionExpression;
    }
    if (options?.expressionAttributeNames) {
      body.ExpressionAttributeNames = options.expressionAttributeNames;
    }
    if (options?.expressionAttributeValues) {
      body.ExpressionAttributeValues = options.expressionAttributeValues;
    }
    if (options?.returnValues) {
      body.ReturnValues = options.returnValues;
    }

    const response = await this.dynamoRequest<{
      Attributes?: DynamoDBItem;
    }>('DeleteItem', body);

    return {
      attributes: response.Attributes,
    };
  }

  /**
   * Update an item in a table
   */
  async updateItem(
    tableName: string,
    key: DynamoDBItem,
    updateExpression: string,
    options?: {
      conditionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
      expressionAttributeValues?: DynamoDBItem;
      returnValues?: 'NONE' | 'UPDATED_OLD' | 'UPDATED_NEW' | 'ALL_OLD' | 'ALL_NEW';
    }
  ): Promise<{ attributes?: DynamoDBItem }> {
    const body: Record<string, unknown> = {
      TableName: tableName,
      Key: key,
      UpdateExpression: updateExpression,
    };

    if (options?.conditionExpression) {
      body.ConditionExpression = options.conditionExpression;
    }
    if (options?.expressionAttributeNames) {
      body.ExpressionAttributeNames = options.expressionAttributeNames;
    }
    if (options?.expressionAttributeValues) {
      body.ExpressionAttributeValues = options.expressionAttributeValues;
    }
    if (options?.returnValues) {
      body.ReturnValues = options.returnValues;
    }

    const response = await this.dynamoRequest<{
      Attributes?: DynamoDBItem;
    }>('UpdateItem', body);

    return {
      attributes: response.Attributes,
    };
  }

  /**
   * Query items from a table
   */
  async query(request: DynamoDBQueryRequest): Promise<DynamoDBQueryResponse> {
    const body: Record<string, unknown> = {
      TableName: request.tableName,
      KeyConditionExpression: request.keyConditionExpression,
    };

    if (request.expressionAttributeNames) {
      body.ExpressionAttributeNames = request.expressionAttributeNames;
    }
    if (request.expressionAttributeValues) {
      body.ExpressionAttributeValues = request.expressionAttributeValues;
    }
    if (request.filterExpression) {
      body.FilterExpression = request.filterExpression;
    }
    if (request.projectionExpression) {
      body.ProjectionExpression = request.projectionExpression;
    }
    if (request.limit !== undefined) {
      body.Limit = request.limit;
    }
    if (request.scanIndexForward !== undefined) {
      body.ScanIndexForward = request.scanIndexForward;
    }
    if (request.exclusiveStartKey) {
      body.ExclusiveStartKey = request.exclusiveStartKey;
    }
    if (request.indexName) {
      body.IndexName = request.indexName;
    }
    if (request.select) {
      body.Select = request.select;
    }
    if (request.consistentRead !== undefined) {
      body.ConsistentRead = request.consistentRead;
    }

    const response = await this.dynamoRequest<{
      Items?: DynamoDBItem[];
      Count?: number;
      ScannedCount?: number;
      LastEvaluatedKey?: DynamoDBItem;
    }>('Query', body);

    return {
      items: response.Items || [],
      count: response.Count || 0,
      scannedCount: response.ScannedCount || 0,
      lastEvaluatedKey: response.LastEvaluatedKey,
    };
  }

  /**
   * Scan items from a table
   */
  async scan(request: DynamoDBScanRequest): Promise<DynamoDBScanResponse> {
    const body: Record<string, unknown> = {
      TableName: request.tableName,
    };

    if (request.filterExpression) {
      body.FilterExpression = request.filterExpression;
    }
    if (request.expressionAttributeNames) {
      body.ExpressionAttributeNames = request.expressionAttributeNames;
    }
    if (request.expressionAttributeValues) {
      body.ExpressionAttributeValues = request.expressionAttributeValues;
    }
    if (request.projectionExpression) {
      body.ProjectionExpression = request.projectionExpression;
    }
    if (request.limit !== undefined) {
      body.Limit = request.limit;
    }
    if (request.exclusiveStartKey) {
      body.ExclusiveStartKey = request.exclusiveStartKey;
    }
    if (request.indexName) {
      body.IndexName = request.indexName;
    }
    if (request.select) {
      body.Select = request.select;
    }
    if (request.consistentRead !== undefined) {
      body.ConsistentRead = request.consistentRead;
    }
    if (request.segment !== undefined) {
      body.Segment = request.segment;
    }
    if (request.totalSegments !== undefined) {
      body.TotalSegments = request.totalSegments;
    }

    const response = await this.dynamoRequest<{
      Items?: DynamoDBItem[];
      Count?: number;
      ScannedCount?: number;
      LastEvaluatedKey?: DynamoDBItem;
    }>('Scan', body);

    return {
      items: response.Items || [],
      count: response.Count || 0,
      scannedCount: response.ScannedCount || 0,
      lastEvaluatedKey: response.LastEvaluatedKey,
    };
  }

  /**
   * Batch get items from multiple tables
   */
  async batchGetItem(
    requestItems: Record<string, {
      keys: DynamoDBItem[];
      consistentRead?: boolean;
      projectionExpression?: string;
      expressionAttributeNames?: Record<string, string>;
    }>
  ): Promise<{
    responses: Record<string, DynamoDBItem[]>;
    unprocessedKeys?: Record<string, { keys: DynamoDBItem[] }>;
  }> {
    const body: Record<string, unknown> = {
      RequestItems: Object.fromEntries(
        Object.entries(requestItems).map(([tableName, request]) => {
          const tableRequest: Record<string, unknown> = {
            Keys: request.keys,
          };
          if (request.consistentRead !== undefined) {
            tableRequest.ConsistentRead = request.consistentRead;
          }
          if (request.projectionExpression) {
            tableRequest.ProjectionExpression = request.projectionExpression;
          }
          if (request.expressionAttributeNames) {
            tableRequest.ExpressionAttributeNames = request.expressionAttributeNames;
          }
          return [tableName, tableRequest];
        })
      ),
    };

    const response = await this.dynamoRequest<{
      Responses?: Record<string, DynamoDBItem[]>;
      UnprocessedKeys?: Record<string, { Keys: DynamoDBItem[] }>;
    }>('BatchGetItem', body);

    return {
      responses: response.Responses || {},
      unprocessedKeys: response.UnprocessedKeys
        ? Object.fromEntries(
            Object.entries(response.UnprocessedKeys).map(([tableName, { Keys }]) => [
              tableName,
              { keys: Keys },
            ])
          )
        : undefined,
    };
  }

  /**
   * Batch write items to multiple tables
   */
  async batchWriteItem(
    requestItems: Record<string, Array<
      | { putRequest: { item: DynamoDBItem } }
      | { deleteRequest: { key: DynamoDBItem } }
    >>
  ): Promise<{
    unprocessedItems?: Record<string, Array<
      | { putRequest: { item: DynamoDBItem } }
      | { deleteRequest: { key: DynamoDBItem } }
    >>;
  }> {
    const body: Record<string, unknown> = {
      RequestItems: Object.fromEntries(
        Object.entries(requestItems).map(([tableName, requests]) => [
          tableName,
          requests.map(request => {
            if ('putRequest' in request) {
              return { PutRequest: { Item: request.putRequest.item } };
            }
            return { DeleteRequest: { Key: request.deleteRequest.key } };
          }),
        ])
      ),
    };

    const response = await this.dynamoRequest<{
      UnprocessedItems?: Record<string, Array<
        | { PutRequest: { Item: DynamoDBItem } }
        | { DeleteRequest: { Key: DynamoDBItem } }
      >>;
    }>('BatchWriteItem', body);

    if (!response.UnprocessedItems || Object.keys(response.UnprocessedItems).length === 0) {
      return {};
    }

    return {
      unprocessedItems: Object.fromEntries(
        Object.entries(response.UnprocessedItems).map(([tableName, requests]) => [
          tableName,
          requests.map(request => {
            if ('PutRequest' in request) {
              return { putRequest: { item: request.PutRequest.Item } };
            }
            return { deleteRequest: { key: request.DeleteRequest.Key } };
          }),
        ])
      ),
    };
  }
}
