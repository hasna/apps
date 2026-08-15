/**
 * @hasna/telephony — server storage barrel.
 *
 * Re-exports the vendored storage kit primitives plus the telephony cloud
 * client and Postgres migrations, so the migration runner and serve import
 * from one place.
 */
export * from "./generated/storage-kit/index.js";
export { PG_MIGRATIONS } from "./lib/pg-migrations.js";
export {
  createTelephonyCloudClient,
  TELEPHONY_APP_NAME,
} from "./db/remote-storage.js";
