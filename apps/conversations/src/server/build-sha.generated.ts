// Dockerfile overwrites this module with the exact source SHA while building
// the deployable image. A source-tree run reports no artifact identity.
export const BAKED_BUILD_SHA: string | null = null;
