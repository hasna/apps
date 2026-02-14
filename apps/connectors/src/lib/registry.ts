/**
 * Connector registry - metadata about all available connectors
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface ConnectorMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  version?: string;
}

export const CATEGORIES = [
  "AI & ML",
  "Developer Tools",
  "Design & Content",
  "Communication",
  "Social Media",
  "Commerce & Finance",
  "Google Workspace",
  "Data & Analytics",
  "Business Tools",
  "Patents & IP",
  "Advertising",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CONNECTORS: ConnectorMeta[] = [
  // AI & ML
  {
    name: "anthropic",
    displayName: "Anthropic",
    description: "Claude AI models and API",
    category: "AI & ML",
    tags: ["ai", "llm", "claude"],
  },
  {
    name: "openai",
    displayName: "OpenAI",
    description: "GPT models, DALL-E, and Whisper",
    category: "AI & ML",
    tags: ["ai", "llm", "gpt", "dalle"],
  },
  {
    name: "xai",
    displayName: "xAI",
    description: "Grok AI models",
    category: "AI & ML",
    tags: ["ai", "llm", "grok"],
  },
  {
    name: "mistral",
    displayName: "Mistral",
    description: "Mistral AI models",
    category: "AI & ML",
    tags: ["ai", "llm"],
  },
  {
    name: "googlegemini",
    displayName: "Google Gemini",
    description: "Gemini AI models",
    category: "AI & ML",
    tags: ["ai", "llm", "google"],
  },
  {
    name: "huggingface",
    displayName: "Hugging Face",
    description: "ML models and datasets hub",
    category: "AI & ML",
    tags: ["ai", "ml", "models"],
  },
  {
    name: "stabilityai",
    displayName: "Stability AI",
    description: "Stable Diffusion image generation",
    category: "AI & ML",
    tags: ["ai", "image", "generation"],
  },
  {
    name: "midjourney",
    displayName: "Midjourney",
    description: "AI image generation",
    category: "AI & ML",
    tags: ["ai", "image", "generation"],
  },
  {
    name: "heygen",
    displayName: "HeyGen",
    description: "AI video generation",
    category: "AI & ML",
    tags: ["ai", "video", "avatar"],
  },
  {
    name: "hedra",
    displayName: "Hedra",
    description: "AI video generation",
    category: "AI & ML",
    tags: ["ai", "video"],
  },
  {
    name: "elevenlabs",
    displayName: "ElevenLabs",
    description: "AI voice synthesis and cloning",
    category: "AI & ML",
    tags: ["ai", "voice", "tts"],
  },
  {
    name: "reducto",
    displayName: "Reducto",
    description: "Document processing and extraction",
    category: "AI & ML",
    tags: ["ai", "document", "ocr"],
  },

  // Developer Tools
  {
    name: "github",
    displayName: "GitHub",
    description: "Repositories, issues, PRs, and actions",
    category: "Developer Tools",
    tags: ["git", "code", "vcs"],
  },
  {
    name: "docker",
    displayName: "Docker",
    description: "Container management and registry",
    category: "Developer Tools",
    tags: ["containers", "devops"],
  },
  {
    name: "sentry",
    displayName: "Sentry",
    description: "Error tracking and monitoring",
    category: "Developer Tools",
    tags: ["monitoring", "errors"],
  },
  {
    name: "cloudflare",
    displayName: "Cloudflare",
    description: "DNS, CDN, and edge computing",
    category: "Developer Tools",
    tags: ["cdn", "dns", "edge"],
  },
  {
    name: "googlecloud",
    displayName: "Google Cloud",
    description: "GCP services and APIs",
    category: "Developer Tools",
    tags: ["cloud", "gcp"],
  },
  {
    name: "aws",
    displayName: "AWS",
    description: "Amazon Web Services",
    category: "Developer Tools",
    tags: ["cloud", "aws"],
  },
  {
    name: "e2b",
    displayName: "E2B",
    description: "Code interpreter sandboxes",
    category: "Developer Tools",
    tags: ["sandbox", "code"],
  },
  {
    name: "firecrawl",
    displayName: "Firecrawl",
    description: "Web scraping and crawling",
    category: "Developer Tools",
    tags: ["scraping", "web"],
  },
  {
    name: "browseruse",
    displayName: "Browser Use",
    description: "Browser automation for AI",
    category: "Developer Tools",
    tags: ["browser", "automation"],
  },
  {
    name: "shadcn",
    displayName: "shadcn/ui",
    description: "UI component registry",
    category: "Developer Tools",
    tags: ["ui", "components", "react"],
  },

  // Design & Content
  {
    name: "figma",
    displayName: "Figma",
    description: "Design files, components, and comments",
    category: "Design & Content",
    tags: ["design", "ui"],
  },
  {
    name: "webflow",
    displayName: "Webflow",
    description: "Website builder and CMS",
    category: "Design & Content",
    tags: ["website", "cms"],
  },
  {
    name: "wix",
    displayName: "Wix",
    description: "Website builder",
    category: "Design & Content",
    tags: ["website"],
  },
  {
    name: "icons8",
    displayName: "Icons8",
    description: "Icons and illustrations",
    category: "Design & Content",
    tags: ["icons", "assets"],
  },

  // Communication
  {
    name: "gmail",
    displayName: "Gmail",
    description: "Email sending and management",
    category: "Communication",
    tags: ["email", "google"],
  },
  {
    name: "discord",
    displayName: "Discord",
    description: "Messaging and communities",
    category: "Communication",
    tags: ["chat", "community"],
  },
  {
    name: "twilio",
    displayName: "Twilio",
    description: "SMS, voice, and messaging",
    category: "Communication",
    tags: ["sms", "voice"],
  },
  {
    name: "resend",
    displayName: "Resend",
    description: "Email API for developers",
    category: "Communication",
    tags: ["email", "api"],
  },
  {
    name: "zoom",
    displayName: "Zoom",
    description: "Video meetings and webinars",
    category: "Communication",
    tags: ["video", "meetings"],
  },
  {
    name: "maropost",
    displayName: "Maropost",
    description: "Email marketing automation",
    category: "Communication",
    tags: ["email", "marketing"],
  },

  // Social Media
  {
    name: "x",
    displayName: "X (Twitter)",
    description: "Posts, threads, and engagement",
    category: "Social Media",
    tags: ["social", "twitter"],
  },
  {
    name: "reddit",
    displayName: "Reddit",
    description: "Posts, comments, and subreddits",
    category: "Social Media",
    tags: ["social", "community"],
  },
  {
    name: "substack",
    displayName: "Substack",
    description: "Newsletter publishing",
    category: "Social Media",
    tags: ["newsletter", "writing"],
  },
  {
    name: "meta",
    displayName: "Meta",
    description: "Facebook and Instagram APIs",
    category: "Social Media",
    tags: ["social", "facebook", "instagram"],
  },
  {
    name: "snap",
    displayName: "Snapchat",
    description: "Snapchat marketing API",
    category: "Social Media",
    tags: ["social", "ads"],
  },
  {
    name: "tiktok",
    displayName: "TikTok",
    description: "TikTok content and ads",
    category: "Social Media",
    tags: ["social", "video"],
  },
  {
    name: "youtube",
    displayName: "YouTube",
    description: "Videos, channels, and analytics",
    category: "Social Media",
    tags: ["video", "google"],
  },

  // Commerce & Finance
  {
    name: "stripe",
    displayName: "Stripe",
    description: "Payments, subscriptions, and billing",
    category: "Commerce & Finance",
    tags: ["payments", "billing"],
  },
  {
    name: "stripeatlas",
    displayName: "Stripe Atlas",
    description: "Company incorporation",
    category: "Commerce & Finance",
    tags: ["incorporation", "business"],
  },
  {
    name: "shopify",
    displayName: "Shopify",
    description: "E-commerce platform",
    category: "Commerce & Finance",
    tags: ["ecommerce", "store"],
  },
  {
    name: "revolut",
    displayName: "Revolut",
    description: "Banking and payments",
    category: "Commerce & Finance",
    tags: ["banking", "fintech"],
  },
  {
    name: "mercury",
    displayName: "Mercury",
    description: "Startup banking",
    category: "Commerce & Finance",
    tags: ["banking", "startup"],
  },
  {
    name: "pandadoc",
    displayName: "PandaDoc",
    description: "Document signing and proposals",
    category: "Commerce & Finance",
    tags: ["documents", "esign"],
  },

  // Google Workspace
  {
    name: "google",
    displayName: "Google",
    description: "Google OAuth and APIs",
    category: "Google Workspace",
    tags: ["google", "auth"],
  },
  {
    name: "googledrive",
    displayName: "Google Drive",
    description: "File storage and sharing",
    category: "Google Workspace",
    tags: ["storage", "google"],
  },
  {
    name: "googledocs",
    displayName: "Google Docs",
    description: "Document creation and editing",
    category: "Google Workspace",
    tags: ["documents", "google"],
  },
  {
    name: "googlesheets",
    displayName: "Google Sheets",
    description: "Spreadsheets and data",
    category: "Google Workspace",
    tags: ["spreadsheets", "google"],
  },
  {
    name: "googlecalendar",
    displayName: "Google Calendar",
    description: "Calendar and events",
    category: "Google Workspace",
    tags: ["calendar", "google"],
  },
  {
    name: "googletasks",
    displayName: "Google Tasks",
    description: "Task management",
    category: "Google Workspace",
    tags: ["tasks", "google"],
  },
  {
    name: "googlecontacts",
    displayName: "Google Contacts",
    description: "Contact management",
    category: "Google Workspace",
    tags: ["contacts", "google"],
  },
  {
    name: "googlemaps",
    displayName: "Google Maps",
    description: "Maps, places, and directions",
    category: "Google Workspace",
    tags: ["maps", "google"],
  },
  // Data & Analytics
  {
    name: "exa",
    displayName: "Exa",
    description: "AI-powered web search",
    category: "Data & Analytics",
    tags: ["search", "ai"],
  },
  {
    name: "mixpanel",
    displayName: "Mixpanel",
    description: "Product analytics",
    category: "Data & Analytics",
    tags: ["analytics", "product"],
  },
  {
    name: "openweathermap",
    displayName: "OpenWeatherMap",
    description: "Weather data and forecasts",
    category: "Data & Analytics",
    tags: ["weather", "data"],
  },
  {
    name: "brandsight",
    displayName: "Brandsight",
    description: "Brand monitoring",
    category: "Data & Analytics",
    tags: ["brand", "monitoring"],
  },

  // Business Tools
  {
    name: "notion",
    displayName: "Notion",
    description: "Pages, databases, blocks, and property management",
    category: "Business Tools",
    tags: ["productivity", "databases", "wiki", "notes"],
  },
  {
    name: "quo",
    displayName: "Quo",
    description: "Business quotes and invoices",
    category: "Business Tools",
    tags: ["invoices", "quotes"],
  },
  {
    name: "tinker",
    displayName: "Tinker",
    description: "Internal tooling",
    category: "Business Tools",
    tags: ["internal", "tools"],
  },
  {
    name: "sedo",
    displayName: "Sedo",
    description: "Domain marketplace",
    category: "Business Tools",
    tags: ["domains", "marketplace"],
  },

  // Patents & IP
  {
    name: "uspto",
    displayName: "USPTO",
    description: "US Patent and Trademark Office",
    category: "Patents & IP",
    tags: ["patents", "trademarks", "ip"],
  },

  // Advertising
  {
    name: "xads",
    displayName: "X Ads",
    description: "Twitter/X advertising",
    category: "Advertising",
    tags: ["ads", "twitter"],
  },
];

export function getConnectorsByCategory(category: Category): ConnectorMeta[] {
  return CONNECTORS.filter((c) => c.category === category);
}

export function searchConnectors(query: string): ConnectorMeta[] {
  const q = query.toLowerCase();
  return CONNECTORS.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some((t) => t.includes(q))
  );
}

export function getConnector(name: string): ConnectorMeta | undefined {
  return CONNECTORS.find((c) => c.name === name);
}

/**
 * Load versions from each connector's package.json into the registry.
 * Call once at CLI startup.
 */
let versionsLoaded = false;

export function loadConnectorVersions(): void {
  if (versionsLoaded) return;
  versionsLoaded = true;

  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Resolve connectors directory from built (bin/) or source (src/lib/) location
  const candidates = [
    join(thisDir, "..", "connectors"),
    join(thisDir, "..", "..", "connectors"),
  ];
  const connectorsDir = candidates.find((d) => existsSync(d));
  if (!connectorsDir) return;

  for (const connector of CONNECTORS) {
    try {
      const pkgPath = join(connectorsDir, `connect-${connector.name}`, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        connector.version = pkg.version || "0.0.0";
      }
    } catch {
      // skip
    }
  }
}
