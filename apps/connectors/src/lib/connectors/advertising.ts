import type { ConnectorMeta } from "../registry.js";

// Advertising
export const connectors: ConnectorMeta[] = [
  {
    name: "xads",
    displayName: "X Ads",
    description: "Twitter/X advertising",
    category: "Advertising",
    tags: ["ads", "twitter"],
  },
  {
    name: "adroll",
    displayName: "AdRoll",
    description: "Advertising platform for campaigns, ads, and audience segments",
    category: "Advertising",
    tags: ["ads", "retargeting", "campaigns"],
  },
  {
    name: "googleads",
    displayName: "Google Ads",
    description: "Campaigns, ad groups, ads, keywords, and reporting",
    category: "Advertising",
    tags: ["google", "ads", "ppc", "campaigns"],
  },
  {
    name: "tiktok-events-api",
    displayName: "TikTok Events API",
    description: "Server-side TikTok Events API 2.0 conversion events, pixels, and event sets",
    category: "Advertising",
    tags: ["tiktok", "events", "pixel", "conversions"],
  },
];
