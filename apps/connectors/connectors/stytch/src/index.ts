export { Stytch, StytchClient, UsersApi, MagicLinksApi, PasswordsApi, SessionsApi, OtpApi, TotpApi, WebauthnApi, CryptoWalletsApi, OAuthApi } from './api';
export * from './types';

export {
  getProjectId,
  setProjectId,
  getSecret,
  setSecret,
  getEnvironment,
  setEnvironment,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
} from './utils/config';

export { formatOutput, success, error, warn, info, heading, print, type OutputFormat } from './utils/output';
