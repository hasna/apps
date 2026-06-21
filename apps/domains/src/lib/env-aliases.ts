export type Env = Record<string, string | undefined>;

export interface EnvMatch {
  key: string;
  value: string;
}

export function firstEnv(env: Env, names: readonly string[]): EnvMatch | undefined {
  for (const key of names) {
    const value = env[key];
    if (value) return { key, value };
  }
  return undefined;
}

export function hasEveryEnv(env: Env, groups: readonly (readonly string[])[]): boolean {
  return groups.every((names) => !!firstEnv(env, names));
}

export function flattenEnvNames(groups: readonly (readonly string[])[]): string[] {
  return Array.from(new Set(groups.flatMap((names) => [...names])));
}

export const NAMECHEAP_ENV = {
  apiKey: ["NAMECHEAP_API_KEY"],
  username: ["NAMECHEAP_USERNAME"],
  clientIp: ["NAMECHEAP_CLIENT_IP"],
} as const;

export const GODADDY_ENV = {
  apiKey: ["GODADDY_API_KEY"],
  apiSecret: ["GODADDY_API_SECRET"],
} as const;

export const BRANDSIGHT_ENV = {
  apiKey: ["BRANDSIGHT_API_KEY"],
  apiSecret: ["BRANDSIGHT_API_SECRET"],
  customerId: ["BRANDSIGHT_CUSTOMER_ID"],
  shopperId: ["BRANDSIGHT_SHOPPER_ID"],
  accountId: ["BRANDSIGHT_ACCOUNT_ID"],
} as const;

export const SEDO_ENV = {
  partnerId: ["SEDO_PARTNER_ID"],
  signKey: ["SEDO_API_KEY", "SEDO_SIGN_KEY"],
  username: ["SEDO_USERNAME", "SEDO_EMAIL"],
  password: ["SEDO_PASSWORD"],
} as const;

export const CLOUDFLARE_ENV = {
  apiToken: ["CLOUDFLARE_API_TOKEN"],
  apiKey: ["CLOUDFLARE_API_KEY"],
  email: ["CLOUDFLARE_EMAIL"],
  accountId: ["CLOUDFLARE_ACCOUNT_ID"],
} as const;

export const ROUTE53_ENV = {
  accessKeyId: ["ROUTE53_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"],
  secretAccessKey: ["ROUTE53_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"],
  sessionToken: ["ROUTE53_SESSION_TOKEN", "AWS_SESSION_TOKEN"],
  profile: ["ROUTE53_AWS_PROFILE", "AWS_PROFILE"],
  region: ["ROUTE53_REGION", "ROUTE53_AWS_REGION", "AWS_REGION"],
  webIdentityTokenFile: ["AWS_WEB_IDENTITY_TOKEN_FILE"],
  roleArn: ["AWS_ROLE_ARN"],
  containerCredentials: [
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  ],
} as const;

export function providerEnvNames(provider: string): string[] {
  switch (provider.toLowerCase()) {
    case "namecheap":
      return flattenEnvNames([NAMECHEAP_ENV.apiKey, NAMECHEAP_ENV.username, NAMECHEAP_ENV.clientIp]);
    case "godaddy":
      return flattenEnvNames([GODADDY_ENV.apiKey, GODADDY_ENV.apiSecret]);
    case "brandsight":
      return flattenEnvNames([
        BRANDSIGHT_ENV.apiKey,
        BRANDSIGHT_ENV.apiSecret,
        BRANDSIGHT_ENV.customerId,
        BRANDSIGHT_ENV.shopperId,
        BRANDSIGHT_ENV.accountId,
      ]);
    case "sedo":
      return flattenEnvNames([SEDO_ENV.partnerId, SEDO_ENV.signKey, SEDO_ENV.username, SEDO_ENV.password]);
    case "cloudflare":
      return flattenEnvNames([CLOUDFLARE_ENV.apiToken, CLOUDFLARE_ENV.apiKey, CLOUDFLARE_ENV.email, CLOUDFLARE_ENV.accountId]);
    case "route53":
      return flattenEnvNames([
        ROUTE53_ENV.profile,
        ROUTE53_ENV.accessKeyId,
        ROUTE53_ENV.secretAccessKey,
        ROUTE53_ENV.sessionToken,
        ROUTE53_ENV.region,
        ROUTE53_ENV.webIdentityTokenFile,
        ROUTE53_ENV.roleArn,
        ROUTE53_ENV.containerCredentials,
      ]);
    default:
      return [];
  }
}

export function hasProviderCredentials(
  provider: string,
  env: Env = process.env as Env,
): boolean {
  switch (provider.toLowerCase()) {
    case "namecheap":
      return hasEveryEnv(env, [NAMECHEAP_ENV.apiKey, NAMECHEAP_ENV.username, NAMECHEAP_ENV.clientIp]);
    case "godaddy":
      return hasEveryEnv(env, [GODADDY_ENV.apiKey, GODADDY_ENV.apiSecret]);
    case "brandsight":
      return hasEveryEnv(env, [BRANDSIGHT_ENV.apiKey, BRANDSIGHT_ENV.apiSecret, BRANDSIGHT_ENV.customerId]);
    case "sedo":
      return hasEveryEnv(env, [SEDO_ENV.partnerId, SEDO_ENV.signKey, SEDO_ENV.username, SEDO_ENV.password]);
    case "cloudflare": {
      const tokenMode = !!firstEnv(env, CLOUDFLARE_ENV.apiToken);
      const keyMode = hasEveryEnv(env, [CLOUDFLARE_ENV.apiKey, CLOUDFLARE_ENV.email]);
      return tokenMode || keyMode;
    }
    case "route53": {
      const profileMode = !!firstEnv(env, ROUTE53_ENV.profile);
      const keyMode = hasEveryEnv(env, [ROUTE53_ENV.accessKeyId, ROUTE53_ENV.secretAccessKey]);
      const webIdentityMode = hasEveryEnv(env, [ROUTE53_ENV.webIdentityTokenFile, ROUTE53_ENV.roleArn]);
      const containerMode = !!firstEnv(env, ROUTE53_ENV.containerCredentials);
      return profileMode || keyMode || webIdentityMode || containerMode;
    }
    default:
      return false;
  }
}
