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
    name: "tiktokads",
    displayName: "TikTok Ads",
    description: "TikTok Marketing API for campaigns, ad groups, ads, reporting, pixels, and creatives",
    category: "Advertising",
    tags: ["tiktok", "ads", "campaigns"],
  },
  {
    name: "the-trade-desk",
    displayName: "The Trade Desk",
    description: "Programmatic ad platform (campaigns, events, search)",
    category: "Advertising",
    tags: ["ads", "programmatic", "dsp"],
  },
];
