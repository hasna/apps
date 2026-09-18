import type { CreateProfileInput, Profile, ProfileSelector, ProfileVariables } from "../types/index.js";
import { ProfileNotFoundError } from "../types/index.js";
import { resolveConfigStore, type ConfigStore } from "../data/config-store.js";
import { PROJECT_DASHBOARD_PROFILE_VARIABLES } from "./project-dashboard-standard.js";

/** Pure selector check (mirrors db profileHasSelectors without touching sqlite). */
function profileHasSelectors(profile: Pick<Profile, "selectors">): boolean {
  const selectors = profile.selectors ?? {};
  return (selectors.os?.length ?? 0) > 0
    || (selectors.arch?.length ?? 0) > 0
    || (selectors.hostnames?.length ?? 0) > 0;
}

export const PLATFORM_PROFILE_PRESETS: CreateProfileInput[] = [
  {
    name: "linux-arm64",
    description: "Default reviewed instruction profile for Linux arm64",
    selectors: { os: ["linux"], arch: ["arm64"] },
    variables: {
      BUN_BIN_DIR: "{{HOME_DIR}}/.bun/bin",
      BUN_PATH: "{{BUN_BIN_DIR}}/bun",
      PATH_PREFIX: "{{BUN_BIN_DIR}}",
      ...PROJECT_DASHBOARD_PROFILE_VARIABLES,
    },
  },
  {
    name: "macos-arm64",
    description: "Default reviewed instruction profile for macOS arm64",
    selectors: { os: ["macos"], arch: ["arm64"] },
    variables: {
      BUN_BIN_DIR: "{{HOME_DIR}}/.bun/bin",
      BUN_PATH: "/opt/homebrew/bin/bun",
      PATH_PREFIX: "/opt/homebrew/bin:{{BUN_BIN_DIR}}",
      ...PROJECT_DASHBOARD_PROFILE_VARIABLES,
    },
  },
];

export async function ensurePlatformProfiles(store: ConfigStore = resolveConfigStore()): Promise<Profile[]> {
  const ensured: Profile[] = [];

  // Resolve all profile reads before writing; a failed hosted lookup is not
  // evidence that a profile is absent or permission to create a replacement.
  const existingProfiles = await Promise.all(PLATFORM_PROFILE_PRESETS.map(async (preset) => {
    try { return await store.getProfile(preset.name); }
    catch (error) { if (error instanceof ProfileNotFoundError) return null; throw error; }
  }));

  for (const [index, preset] of PLATFORM_PROFILE_PRESETS.entries()) {
    let profile: Profile;
    const existing = existingProfiles[index];
    if (existing) {
      profile = existing;
      const selectors = mergeProfileSelectors(preset.selectors, profile.selectors);
      const variables = mergeProfileVariables(preset.variables, profile.variables);
      if (
        JSON.stringify(selectors) !== JSON.stringify(profile.selectors)
        || JSON.stringify(variables) !== JSON.stringify(profile.variables)
      ) {
        profile = await store.updateProfile(profile.id, {
          description: profile.description ?? preset.description,
          selectors,
          variables,
        });
      }
    } else {
      profile = await store.createProfile(preset);
    }

    // Source membership is an explicit review decision. Initialization must
    // not promote provider, project or role rules into global defaults.
    // Existing reviewed memberships are retained without adding any source.
    ensured.push(profile);
  }

  return ensured;
}

function mergeProfileSelectors(
  preset: ProfileSelector | undefined,
  existing: ProfileSelector,
): ProfileSelector {
  if (!profileHasSelectors({ selectors: existing })) return preset ?? {};
  return {
    os: mergeUnique(preset?.os, existing.os),
    arch: mergeUnique(preset?.arch, existing.arch),
    hostnames: mergeUnique(preset?.hostnames, existing.hostnames),
  };
}

function mergeProfileVariables(
  preset: ProfileVariables | undefined,
  existing: ProfileVariables,
): ProfileVariables {
  const variables = {
    ...(preset ?? {}),
    ...existing,
  };
  for (const [key, value] of Object.entries(preset ?? {})) {
    if (value === "") variables[key] = value;
  }
  return variables;
}

function mergeUnique(
  preset: string[] | undefined,
  existing: string[] | undefined,
): string[] | undefined {
  const values = [...new Set([...(preset ?? []), ...(existing ?? [])])];
  return values.length > 0 ? values : undefined;
}
