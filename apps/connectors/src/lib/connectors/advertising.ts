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
    name: "taboola",
    displayName: "Taboola",
    description: "Native advertising campaigns, items, reports, and audiences via the Backstage API",
    category: "Advertising",
    tags: ["taboola", "native-advertising", "campaigns", "backstage"],
  },
];
