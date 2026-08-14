// Vercel AI Gateway Connector
// TypeScript wrapper for Vercel AI Gateway API

export { VercelAiGateway, VercelAiGatewayClient, resolveBaseUrl, OPENAI_BASE_URL, ANTHROPIC_BASE_URL, OPENRESPONSES_BASE_URL } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
