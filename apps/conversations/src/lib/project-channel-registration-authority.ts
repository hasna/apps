// The package-owned project-channel registration authority, bound to the
// active Store. Store-free module: the factory only wraps whatever
// `ConversationsStore` it is handed (default: `getStore()`, the hosted API), so
// `@hasna/conversations` consumers (hasna/apps `projects`) reach it without
// pulling the legacy SQLite domain library into their bundle.
import type {
  ProjectChannelRegistrationAuthority,
  ProjectChannelRegistrationAuthorityStore,
} from "./project-channel-registration.js";

export const PROJECT_CHANNEL_REGISTRATION_ROUTE = "/v1/project-registration/channels";

async function activeAuthorityStore(
  explicit?: ProjectChannelRegistrationAuthorityStore,
): Promise<ProjectChannelRegistrationAuthorityStore> {
  if (explicit) return explicit;
  const { getStore } = await import("./store/index.js");
  return getStore();
}

export function createProjectChannelRegistrationAuthority(
  store?: ProjectChannelRegistrationAuthorityStore,
): ProjectChannelRegistrationAuthority {
  return {
    authority: "conversations",
    async capability() {
      return (await activeAuthorityStore(store)).projectChannelRegistrationCapability();
    },
    async create(request) {
      return (await activeAuthorityStore(store)).registerProjectChannel(request);
    },
    async readExact(request) {
      return (await activeAuthorityStore(store)).readProjectChannelRegistrationExact(request);
    },
    async lookupReceipt(request) {
      return (await activeAuthorityStore(store)).lookupProjectChannelRegistrationReceipt(request);
    },
    async compensate(request) {
      return (await activeAuthorityStore(store)).compensateProjectChannelRegistration(request);
    },
    async verifyInverse(request) {
      return (await activeAuthorityStore(store)).verifyProjectChannelRegistrationInverse(request);
    },
  };
}
