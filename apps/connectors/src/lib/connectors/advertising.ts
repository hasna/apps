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
  {
    name: "stackadapt",
    displayName: "StackAdapt",
    description: "Programmatic advertising campaigns, conversion trackers, and reporting",
    category: "Advertising",
    tags: ["ads", "programmatic", "campaigns"],
  },
  {
    name: "tiktok-events-api",
    displayName: "TikTok Events API",
    description: "Server-side TikTok Events API 2.0 conversion events, pixels, and event sets",
    category: "Advertising",
    tags: ["tiktok", "events", "pixel", "conversions"],
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
  {
    name: "terminus",
    displayName: "Terminus",
    description: "UTM parameter and tracked link management via the Terminus API",
    category: "Advertising",
    tags: ["abm", "marketing", "utm", "links"],
  },
  {
    name: "taboola",
    displayName: "Taboola",
    description: "Native advertising campaigns, items, reports, and audiences via the Backstage API",
    category: "Advertising",
    tags: ["taboola", "native-advertising", "campaigns", "backstage"],
  },
];
