/**
 * @hasna/connect-takecareos
 *
 * TakeCareOS home-care agency connector — clients, caregivers, shifts, incidents,
 * invoices and compliance reporting over the public REST API. Stateless raw-fetch
 * transport with Bearer API-key auth.
 */
export { TakeCareOS, TakeCareOSClientTransport } from "./api/index";
export type { ListOptions, RequestOptions } from "./api/index";

export {
  TakeCareOSApiError,
  type TakeCareOSConfig,
  type TakeCareOSClient,
  type TakeCareOSCaregiver,
  type TakeCareOSShift,
  type CreateShiftInput,
  type TakeCareOSIncident,
  type CreateIncidentInput,
  type TakeCareOSInvoice,
  type TakeCareOSComplianceReport,
  type TakeCareOSList,
} from "./types/index";

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  type ProfileConfig,
} from "./utils/config";

export { formatOutput, print, type OutputFormat } from "./utils/output";
