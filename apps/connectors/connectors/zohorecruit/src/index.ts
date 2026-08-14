/**
 * @hasna/connect-zohorecruit
 *
 * Zoho Recruit ATS connector. OAuth REST API v2 with multi data-center support.
 */
export { ZohoRecruit, ZohoRecruitClient, RECRUIT_DC_BASES, resolveRecruitBaseUrl } from './api/index';
export {
  ZohoRecruitApiError,
  type ZohoRecruitConfig,
  type ZohoRecruitDataCenter,
  type ZohoRecruitRecord,
  type ZohoRecruitRecordList,
  type ZohoRecruitModule,
  type ZohoRecruitField,
  type ZohoRecruitUser,
  type ZohoRecruitNote,
  type ZohoRecruitOrganization,
} from './types/index';

export {
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getOAuthConfig,
  setOAuthConfig,
  loadOAuthTokens,
  saveOAuthTokens,
  clearOAuthTokens,
  getAccessToken,
} from './utils/config';

export {
  getAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  startCallbackServer,
  getValidAccessToken,
  isAuthenticated,
  getRedirectUri,
  getRedirectPort,
  type AuthResult,
  type AuthUrlOptions,
} from './utils/auth';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  setVerboseMode,
  isVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
