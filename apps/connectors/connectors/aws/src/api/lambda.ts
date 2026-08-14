import type { AWSClient } from './client';
import type {
  LambdaFunction,
  LambdaListFunctionsResponse,
  LambdaInvokeRequest,
  LambdaInvokeResponse,
  LambdaFunctionConfiguration,
} from '../types';

/**
 * Lambda API client
 */
export class LambdaApi {
  private readonly client: AWSClient;

  constructor(client: AWSClient) {
    this.client = client;
  }

  /**
   * List Lambda functions
   */
  async listFunctions(options?: {
    maxItems?: number;
    marker?: string;
    masterRegion?: string;
    functionVersion?: 'ALL';
  }): Promise<LambdaListFunctionsResponse> {
    const params: Record<string, string | number | boolean | undefined> = {
      MaxItems: options?.maxItems,
      Marker: options?.marker,
      MasterRegion: options?.masterRegion,
      FunctionVersion: options?.functionVersion,
    };

    const response = await this.client.request<{
      Functions?: Array<{
        FunctionName?: string;
        FunctionArn?: string;
        Runtime?: string;
        Role?: string;
        Handler?: string;
        CodeSize?: number;
        Description?: string;
        Timeout?: number;
        MemorySize?: number;
        LastModified?: string;
        Version?: string;
        State?: string;
        StateReason?: string;
        StateReasonCode?: string;
        PackageType?: 'Zip' | 'Image';
        Architectures?: string[];
      }>;
      NextMarker?: string;
    }>('/2015-03-31/functions', {
      service: 'lambda',
      params,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return {
      functions: (response.Functions || []).map(f => ({
        functionName: f.FunctionName || '',
        functionArn: f.FunctionArn,
        runtime: f.Runtime,
        role: f.Role,
        handler: f.Handler,
        codeSize: f.CodeSize,
        description: f.Description,
        timeout: f.Timeout,
        memorySize: f.MemorySize,
        lastModified: f.LastModified,
        version: f.Version,
        state: f.State,
        stateReason: f.StateReason,
        stateReasonCode: f.StateReasonCode,
        packageType: f.PackageType,
        architectures: f.Architectures,
      })),
      nextMarker: response.NextMarker,
    };
  }

  /**
   * Get a Lambda function
   */
  async getFunction(functionName: string, qualifier?: string): Promise<{
    configuration: LambdaFunctionConfiguration;
    code?: {
      repositoryType?: string;
      location?: string;
      imageUri?: string;
    };
    tags?: Record<string, string>;
  }> {
    const path = qualifier
      ? `/2015-03-31/functions/${encodeURIComponent(functionName)}?Qualifier=${encodeURIComponent(qualifier)}`
      : `/2015-03-31/functions/${encodeURIComponent(functionName)}`;

    const response = await this.client.request<{
      Configuration?: {
        FunctionName?: string;
        FunctionArn?: string;
        Runtime?: string;
        Role?: string;
        Handler?: string;
        CodeSize?: number;
        Description?: string;
        Timeout?: number;
        MemorySize?: number;
        LastModified?: string;
        Version?: string;
        State?: string;
        StateReason?: string;
        StateReasonCode?: string;
        PackageType?: 'Zip' | 'Image';
        Architectures?: string[];
        Environment?: {
          Variables?: Record<string, string>;
        };
        Layers?: Array<{
          Arn: string;
          CodeSize?: number;
        }>;
        VpcConfig?: {
          SubnetIds?: string[];
          SecurityGroupIds?: string[];
          VpcId?: string;
        };
      };
      Code?: {
        RepositoryType?: string;
        Location?: string;
        ImageUri?: string;
      };
      Tags?: Record<string, string>;
    }>(path, {
      service: 'lambda',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const config = response.Configuration || {};

    return {
      configuration: {
        functionName: config.FunctionName || functionName,
        functionArn: config.FunctionArn,
        runtime: config.Runtime,
        role: config.Role,
        handler: config.Handler,
        codeSize: config.CodeSize,
        description: config.Description,
        timeout: config.Timeout,
        memorySize: config.MemorySize,
        lastModified: config.LastModified,
        version: config.Version,
        state: config.State,
        stateReason: config.StateReason,
        stateReasonCode: config.StateReasonCode,
        packageType: config.PackageType,
        architectures: config.Architectures,
        environment: config.Environment ? {
          variables: config.Environment.Variables,
        } : undefined,
        layers: config.Layers?.map(l => ({
          arn: l.Arn,
          codeSize: l.CodeSize,
        })),
        vpcConfig: config.VpcConfig ? {
          subnetIds: config.VpcConfig.SubnetIds,
          securityGroupIds: config.VpcConfig.SecurityGroupIds,
          vpcId: config.VpcConfig.VpcId,
        } : undefined,
      },
      code: response.Code ? {
        repositoryType: response.Code.RepositoryType,
        location: response.Code.Location,
        imageUri: response.Code.ImageUri,
      } : undefined,
      tags: response.Tags,
    };
  }

  /**
   * Invoke a Lambda function
   */
  async invoke(request: LambdaInvokeRequest): Promise<LambdaInvokeResponse> {
    const {
      functionName,
      payload,
      invocationType = 'RequestResponse',
      logType = 'None',
      qualifier,
    } = request;

    const path = qualifier
      ? `/2015-03-31/functions/${encodeURIComponent(functionName)}/invocations?Qualifier=${encodeURIComponent(qualifier)}`
      : `/2015-03-31/functions/${encodeURIComponent(functionName)}/invocations`;

    const body = payload ? JSON.stringify(payload) : undefined;

    const response = await this.client.requestRaw(path, {
      method: 'POST',
      service: 'lambda',
      body: body ? new TextEncoder().encode(body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        'X-Amz-Invocation-Type': invocationType,
        'X-Amz-Log-Type': logType,
      },
    });

    let responsePayload: unknown;
    if (response.data.length > 0) {
      try {
        responsePayload = JSON.parse(new TextDecoder().decode(response.data));
      } catch {
        responsePayload = new TextDecoder().decode(response.data);
      }
    }

    const logResult = response.headers.get('x-amz-log-result');

    return {
      statusCode: response.status,
      functionError: response.headers.get('x-amz-function-error') || undefined,
      logResult: logResult ? atob(logResult) : undefined,
      payload: responsePayload,
      executedVersion: response.headers.get('x-amz-executed-version') || undefined,
    };
  }

  /**
   * Invoke a Lambda function asynchronously
   */
  async invokeAsync(functionName: string, payload?: unknown): Promise<{ status: number }> {
    const response = await this.invoke({
      functionName,
      payload,
      invocationType: 'Event',
    });

    return { status: response.statusCode };
  }

  /**
   * Get function configuration
   */
  async getFunctionConfiguration(functionName: string, qualifier?: string): Promise<LambdaFunctionConfiguration> {
    const path = qualifier
      ? `/2015-03-31/functions/${encodeURIComponent(functionName)}/configuration?Qualifier=${encodeURIComponent(qualifier)}`
      : `/2015-03-31/functions/${encodeURIComponent(functionName)}/configuration`;

    const response = await this.client.request<{
      FunctionName?: string;
      FunctionArn?: string;
      Runtime?: string;
      Role?: string;
      Handler?: string;
      CodeSize?: number;
      Description?: string;
      Timeout?: number;
      MemorySize?: number;
      LastModified?: string;
      Version?: string;
      State?: string;
      StateReason?: string;
      StateReasonCode?: string;
      PackageType?: 'Zip' | 'Image';
      Architectures?: string[];
      Environment?: {
        Variables?: Record<string, string>;
      };
      Layers?: Array<{
        Arn: string;
        CodeSize?: number;
      }>;
      VpcConfig?: {
        SubnetIds?: string[];
        SecurityGroupIds?: string[];
        VpcId?: string;
      };
    }>(path, {
      service: 'lambda',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    return {
      functionName: response.FunctionName || functionName,
      functionArn: response.FunctionArn,
      runtime: response.Runtime,
      role: response.Role,
      handler: response.Handler,
      codeSize: response.CodeSize,
      description: response.Description,
      timeout: response.Timeout,
      memorySize: response.MemorySize,
      lastModified: response.LastModified,
      version: response.Version,
      state: response.State,
      stateReason: response.StateReason,
      stateReasonCode: response.StateReasonCode,
      packageType: response.PackageType,
      architectures: response.Architectures,
      environment: response.Environment ? {
        variables: response.Environment.Variables,
      } : undefined,
      layers: response.Layers?.map(l => ({
        arn: l.Arn,
        codeSize: l.CodeSize,
      })),
      vpcConfig: response.VpcConfig ? {
        subnetIds: response.VpcConfig.SubnetIds,
        securityGroupIds: response.VpcConfig.SecurityGroupIds,
        vpcId: response.VpcConfig.VpcId,
      } : undefined,
    };
  }
}
