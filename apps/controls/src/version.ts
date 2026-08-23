import pkg from "../package.json";

/** Single source of truth for the app version (derived from package.json). */
export const APP_VERSION = pkg.version;
