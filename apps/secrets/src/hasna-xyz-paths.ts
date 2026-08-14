export type HasnaXyzSecretPathKind = "generic" | "app" | "infra";

export interface HasnaXyzSecretPathValidation {
  valid: boolean;
  kind: HasnaXyzSecretPathKind;
  error?: string;
}

const APP_TYPES = new Set(["opensource", "internalapp", "companywebsite", "project"]);
const DEPRECATED_APP_TYPES = new Set(["connector", "website", "platform"]);
const ENVS = new Set(["prod", "staging", "dev", "preview", "lab", "local", "test", "sandbox", "live"]);
const DISALLOWED_APP_PREFIXES = ["open-", "iapp-", "cweb-", "project-"];

function isToken(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isComponentToken(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*$/.test(value);
}

function isEnv(value: string): boolean {
  return ENVS.has(value) || /^pr-\d+$/.test(value);
}

function invalid(kind: HasnaXyzSecretPathKind, error: string): HasnaXyzSecretPathValidation {
  return { valid: false, kind, error };
}

function valid(kind: HasnaXyzSecretPathKind): HasnaXyzSecretPathValidation {
  return { valid: true, kind };
}

export function validateHasnaXyzSecretPath(key: string): HasnaXyzSecretPathValidation {
  const parts = key.split("/");

  if (parts[0] !== "hasna") {
    return valid("generic");
  }

  if (parts[1] !== "xyz") {
    return valid("generic");
  }

  if (parts.some((part) => part.length === 0)) {
    return invalid("generic", "Hasna XYZ secret paths must not contain empty segments");
  }

  const [, division, ownerType] = parts;
  if (!division || !isToken(division)) {
    return invalid("generic", "Hasna XYZ division must be a lowercase token");
  }

  if (!ownerType) {
    return invalid("generic", "Hasna XYZ secret path is missing an app type or infra owner segment");
  }

  if (DEPRECATED_APP_TYPES.has(ownerType)) {
    return invalid(
      "app",
      `Deprecated Hasna XYZ app type "${ownerType}" is not allowed; use opensource, internalapp, companywebsite, project, or infra`
    );
  }

  if (ownerType === "infra") {
    if (parts.length !== 6 && parts.length !== 7) {
      return invalid(
        "infra",
        "Infra-owned Hasna XYZ secrets must use hasna/{division}/infra/{resource_group}/{env}/{component}[/role]"
      );
    }

    const [, , , resourceGroup, env, component, role] = parts;
    if (!resourceGroup || !isToken(resourceGroup)) {
      return invalid("infra", "Infra-owned Hasna XYZ secrets require a lowercase resource group token");
    }
    if (!env || !isEnv(env)) {
      return invalid("infra", `Invalid Hasna XYZ environment "${env}"`);
    }
    if (!component || !isComponentToken(component)) {
      return invalid("infra", "Infra-owned Hasna XYZ secrets require a lowercase component token");
    }
    if (role && !isToken(role)) {
      return invalid("infra", "Infra-owned Hasna XYZ role segment must be a lowercase token");
    }
    return valid("infra");
  }

  if (!APP_TYPES.has(ownerType)) {
    return invalid(
      "app",
      `Unknown Hasna XYZ app type "${ownerType}"; use opensource, internalapp, companywebsite, project, or infra`
    );
  }

  if (parts.length !== 6 && parts.length !== 7) {
    return invalid(
      "app",
      "App-owned Hasna XYZ secrets must use hasna/{division}/{app_type}/{app}/{env}/{component}[/legacy-role]"
    );
  }

  const [, , , app, env, component, legacyRole] = parts;
  if (!app || !isToken(app)) {
    return invalid("app", "App-owned Hasna XYZ secrets require a lowercase app token");
  }
  const disallowedPrefix = DISALLOWED_APP_PREFIXES.find((prefix) => app.startsWith(prefix));
  if (disallowedPrefix) {
    return invalid(
      "app",
      `App token "${app}" must not include repo prefix "${disallowedPrefix}"; strip repo prefixes from canonical paths`
    );
  }
  if (!env || !isEnv(env)) {
    return invalid("app", `Invalid Hasna XYZ environment "${env}"`);
  }
  if (!component || !isComponentToken(component)) {
    return invalid("app", "App-owned Hasna XYZ secrets require a lowercase component token");
  }
  if (legacyRole && legacyRole !== "legacy-master") {
    return invalid("app", "App-owned Hasna XYZ seven-segment aliases may only use the legacy-master role");
  }

  return valid("app");
}

export function assertValidSecretPath(key: string): void {
  const result = validateHasnaXyzSecretPath(key);
  if (!result.valid) {
    throw new Error(result.error);
  }
}
