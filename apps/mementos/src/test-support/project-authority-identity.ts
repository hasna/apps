import { MEMENTOS_PROJECT_AUTHORITY_ENV } from "../project-registration/identity.js";

export const TEST_MEMENTOS_PROJECT_AUTHORITY_IDENTITY = {
  authority_id: "mementos",
  tenant_id: "default",
  corpus_id: "default",
} as const;

export function projectAuthorityTestEnv(): Record<string, string> {
  return {
    [MEMENTOS_PROJECT_AUTHORITY_ENV.authorityId]:
      TEST_MEMENTOS_PROJECT_AUTHORITY_IDENTITY.authority_id,
    [MEMENTOS_PROJECT_AUTHORITY_ENV.tenantId]:
      TEST_MEMENTOS_PROJECT_AUTHORITY_IDENTITY.tenant_id,
    [MEMENTOS_PROJECT_AUTHORITY_ENV.corpusId]:
      TEST_MEMENTOS_PROJECT_AUTHORITY_IDENTITY.corpus_id,
  };
}

export function configureProjectAuthorityTestIdentity(): void {
  Object.assign(process.env, projectAuthorityTestEnv());
}
