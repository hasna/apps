// AWS Connector
// TypeScript wrapper for AWS S3, Lambda, and DynamoDB

export { AWS } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { AWSClient, S3Api, LambdaApi, DynamoDBApi } from './api';

// Export config utilities
export {
  getAccessKeyId,
  setAccessKeyId,
  getSecretAccessKey,
  setSecretAccessKey,
  getRegion,
  setRegion,
  getSessionToken,
  setSessionToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
