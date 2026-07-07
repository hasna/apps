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
    name: "spotify-ads",
    displayName: "Spotify Ads",
    description: "Spotify advertising API (campaigns, ad sets, ads, reporting)",
    category: "Advertising",
    tags: ["spotify", "ads", "campaigns"],
  },
];
