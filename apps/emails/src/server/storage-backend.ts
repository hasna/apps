import { assertNoRetiredEmailsSelectors, readAliasedSetting } from "../lib/client-settings.js";

export const SERVER_DATABASE_URL_SETTING = "HASNA_EMAILS_DATABASE_URL";
export const SERVER_DATABASE_URL_SETTINGS = Object.freeze([
  SERVER_DATABASE_URL_SETTING, "EMAILS_DATABASE_URL",
] as const);
export const RETIRED_SERVER_MODE_SETTINGS = Object.freeze(["EMAILS_MODE", "HASNA_EMAILS_MODE"] as const);
export type ServerStorageBackend = "postgresql";

export class ServerStorageConfigurationError extends Error {
  readonly settings: readonly string[];
  constructor(message: string, settings: readonly string[]) {
    super(message);
    this.name = "ServerStorageConfigurationError";
    this.settings = Object.freeze([...settings]);
  }
}

/** Resolve server-only PostgreSQL configuration without opening a connection. */
export function resolveServerDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  assertNoRetiredEmailsSelectors(env);
  const setting = readAliasedSetting(env, SERVER_DATABASE_URL_SETTINGS);
  const reject = (): never => {
    throw new ServerStorageConfigurationError(
      `${SERVER_DATABASE_URL_SETTING} is required and must be a PostgreSQL connection URL. No SQLite service fallback exists.`,
      SERVER_DATABASE_URL_SETTINGS,
    );
  };
  if (!setting || /[\u0000-\u0020\u007f]/.test(setting.value)) return reject();
  let url: URL;
  try { url = new URL(setting.value); } catch { return reject(); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || url.hash) return reject();
  return setting.value;
}

export function resolveServerStorageBackend(
  env: NodeJS.ProcessEnv = process.env,
  _options: { announce?: (message: string) => void } = {},
): ServerStorageBackend {
  resolveServerDatabaseUrl(env);
  return "postgresql";
}

/** Temporary source compatibility during removal of the remaining dispatcher. */
export function retiredSettingNotice(settings: readonly string[]): string {
  return `${settings.join(", ")} are retired. Remove them and configure server-side PostgreSQL.`;
}
export function resetRetiredSettingNoticeForTests(): void {}
