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
    description: "LLM fine-tuning and training API",
    category: "AI & ML",
    tags: ["ai", "llm", "fine-tuning"],
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

  // Project Management
  {
    name: "linear",
    displayName: "Linear",
    description: "Issue tracking and project management",
    category: "Business Tools",
    tags: ["issues", "project-management"],
  },
  {
    name: "jira",
    displayName: "Jira",
    description: "Issue tracking, projects, and agile boards",
    category: "Business Tools",
    tags: ["issues", "project-management", "agile"],
  },
  {
    name: "confluence",
    displayName: "Confluence",
    description: "Pages, spaces, and content management",
    category: "Business Tools",
    tags: ["wiki", "documentation"],
  },
  {
    name: "asana",
    displayName: "Asana",
    description: "Projects, tasks, and team workflows",
    category: "Business Tools",
    tags: ["tasks", "project-management"],
  },
  {
    name: "trello",
    displayName: "Trello",
    description: "Boards, lists, and cards",
    category: "Business Tools",
    tags: ["kanban", "project-management"],
  },
  {
    name: "clickup",
    displayName: "ClickUp",
    description: "Tasks, docs, and project management",
    category: "Business Tools",
    tags: ["tasks", "project-management"],
  },
  {
    name: "todoist",
    displayName: "Todoist",
    description: "Task management and to-do lists",
    category: "Business Tools",
    tags: ["tasks", "todo"],
  },

  // Messaging
  {
    name: "slack",
    displayName: "Slack",
    description: "Channels, messages, and workspace management",
    category: "Communication",
    tags: ["chat", "messaging", "workspace"],
  },
  {
    name: "telegram",
    displayName: "Telegram",
    description: "Bot API for messages, chats, and updates",
    category: "Communication",
    tags: ["chat", "bot", "messaging"],
  },
  {
    name: "whatsapp",
    displayName: "WhatsApp",
    description: "Business Cloud API for messages and templates",
    category: "Communication",
    tags: ["messaging", "business"],
  },

  // CRM & Sales
  {
    name: "hubspot",
    displayName: "HubSpot",
    description: "CRM contacts, companies, deals, and tickets",
    category: "Business Tools",
    tags: ["crm", "sales", "marketing"],
  },
  {
    name: "salesforce",
    displayName: "Salesforce",
    description: "CRM accounts, contacts, leads, and opportunities",
    category: "Business Tools",
    tags: ["crm", "sales", "enterprise"],
  },

  // Customer Support
  {
    name: "intercom",
    displayName: "Intercom",
    description: "Contacts, conversations, and customer engagement",
    category: "Communication",
    tags: ["support", "messaging", "crm"],
  },
  {
    name: "zendesk",
    displayName: "Zendesk",
    description: "Support tickets and helpdesk",
    category: "Business Tools",
    tags: ["support", "helpdesk", "tickets"],
  },
  {
    name: "freshdesk",
    displayName: "Freshdesk",
    description: "Helpdesk and customer support",
    category: "Business Tools",
    tags: ["support", "helpdesk"],
  },
  {
    name: "crisp",
    displayName: "Crisp",
    description: "Customer messaging and live chat",
    category: "Communication",
    tags: ["chat", "support", "messaging"],
  },
  {
    name: "drift",
    displayName: "Drift",
    description: "Conversational marketing and sales",
    category: "Communication",
    tags: ["chat", "marketing", "sales"],
  },

  // Email Marketing
  {
    name: "mailchimp",
    displayName: "Mailchimp",
    description: "Email marketing and automation",
    category: "Communication",
    tags: ["email", "marketing", "automation"],
  },
  {
    name: "convertkit",
    displayName: "ConvertKit",
    description: "Email marketing for creators",
    category: "Communication",
    tags: ["email", "marketing", "creators"],
  },
  {
    name: "sendgrid",
    displayName: "SendGrid",
    description: "Email delivery and marketing",
    category: "Communication",
    tags: ["email", "api", "transactional"],
  },

  // Infrastructure
  {
    name: "vercel",
    displayName: "Vercel",
    description: "Deployment and hosting platform",
    category: "Developer Tools",
    tags: ["hosting", "deployment", "serverless"],
  },
  {
    name: "netlify",
    displayName: "Netlify",
    description: "Web hosting and deployment",
    category: "Developer Tools",
    tags: ["hosting", "deployment", "jamstack"],
  },
  {
    name: "supabase",
    displayName: "Supabase",
    description: "PostgreSQL database and auth",
    category: "Developer Tools",
    tags: ["database", "auth", "postgres"],
  },
  {
    name: "mongodb",
    displayName: "MongoDB",
    description: "Document database and Atlas",
    category: "Developer Tools",
    tags: ["database", "nosql"],
  },

  // Data & Analytics (additional)
  {
    name: "airtable",
    displayName: "Airtable",
    description: "Spreadsheet-database hybrid",
    category: "Data & Analytics",
    tags: ["database", "spreadsheet"],
  },
  {
    name: "segment",
    displayName: "Segment",
    description: "Customer data platform",
    category: "Data & Analytics",
    tags: ["analytics", "cdp", "data"],
  },
  {
    name: "amplitude",
    displayName: "Amplitude",
    description: "Product analytics platform",
    category: "Data & Analytics",
    tags: ["analytics", "product"],
  },
  {
    name: "posthog",
    displayName: "PostHog",
    description: "Product analytics and feature flags",
    category: "Data & Analytics",
    tags: ["analytics", "feature-flags"],
  },

  // Commerce (additional)
  {
    name: "paypal",
    displayName: "PayPal",
    description: "Payments and checkout",
    category: "Commerce & Finance",
    tags: ["payments", "checkout"],
  },
  {
    name: "lemonsqueezy",
    displayName: "Lemon Squeezy",
    description: "Payments for digital products",
    category: "Commerce & Finance",
    tags: ["payments", "digital", "saas"],
  },
  {
    name: "gumroad",
    displayName: "Gumroad",
    description: "Sell digital products and memberships",
    category: "Commerce & Finance",
    tags: ["ecommerce", "digital", "creators"],
  },

  // Scheduling & Documents
  {
    name: "calendly",
    displayName: "Calendly",
    description: "Scheduling and appointment booking",
    category: "Business Tools",
    tags: ["scheduling", "calendar"],
  },
  {
    name: "docusign",
    displayName: "DocuSign",
    description: "Electronic signatures and agreements",
    category: "Business Tools",
    tags: ["esign", "documents", "contracts"],
  },

  // Social (additional)
  {
    name: "pinterest",
    displayName: "Pinterest",
    description: "Pins, boards, and visual discovery",
    category: "Social Media",
    tags: ["social", "visual", "marketing"],
  },
  {
    name: "linkedin",
    displayName: "LinkedIn",
    description: "Professional network and marketing",
    category: "Social Media",
    tags: ["social", "professional", "b2b"],
  },

  // AI & ML (batch 5)
  {
    name: "groq",
    displayName: "Groq",
    description: "Ultra-fast LLM inference",
    category: "AI & ML",
    tags: ["ai", "llm", "inference"],
  },
  {
    name: "replicate",
    displayName: "Replicate",
    description: "Run ML models in the cloud",
    category: "AI & ML",
    tags: ["ai", "ml", "models"],
  },
  {
    name: "together",
    displayName: "Together AI",
    description: "Open-source model inference and fine-tuning",
    category: "AI & ML",
    tags: ["ai", "llm", "open-source"],
  },
  {
    name: "cohere",
    displayName: "Cohere",
    description: "Enterprise NLP and embeddings",
    category: "AI & ML",
    tags: ["ai", "nlp", "embeddings"],
  },
  {
    name: "deepseek",
    displayName: "DeepSeek",
    description: "AI coding and reasoning models",
    category: "AI & ML",
    tags: ["ai", "llm", "coding"],
  },
  {
    name: "perplexity",
    displayName: "Perplexity",
    description: "AI search and answer engine",
    category: "AI & ML",
    tags: ["ai", "search", "llm"],
  },
  {
    name: "fal",
    displayName: "fal.ai",
    description: "Fast image and video generation",
    category: "AI & ML",
    tags: ["ai", "image", "video"],
  },
  {
    name: "baseten",
    displayName: "Baseten",
    description: "ML model deployment and inference",
    category: "AI & ML",
    tags: ["ai", "ml", "deployment"],
  },
  {
    name: "fireworks",
    displayName: "Fireworks AI",
    description: "Fast generative AI inference",
    category: "AI & ML",
    tags: ["ai", "llm", "inference"],
  },
  {
    name: "cerebras",
    displayName: "Cerebras",
    description: "Ultra-fast AI inference",
    category: "AI & ML",
    tags: ["ai", "llm", "inference"],
  },
  {
    name: "modal",
    displayName: "Modal",
    description: "Serverless GPU compute for AI",
    category: "AI & ML",
    tags: ["ai", "gpu", "serverless"],
  },
  {
    name: "deepgram",
    displayName: "Deepgram",
    description: "Speech-to-text and audio intelligence",
    category: "AI & ML",
    tags: ["ai", "speech", "stt"],
  },
  {
    name: "assemblyai",
    displayName: "AssemblyAI",
    description: "Speech recognition and audio intelligence",
    category: "AI & ML",
    tags: ["ai", "speech", "transcription"],
  },
  {
    name: "roboflow",
    displayName: "Roboflow",
    description: "Computer vision models and datasets",
    category: "AI & ML",
    tags: ["ai", "vision", "cv"],
  },
  {
    name: "runway",
    displayName: "Runway",
    description: "AI video generation and editing",
    category: "AI & ML",
    tags: ["ai", "video", "generation"],
  },
  {
    name: "luma",
    displayName: "Luma AI",
    description: "AI video and 3D generation",
    category: "AI & ML",
    tags: ["ai", "video", "3d"],
  },

  // DevOps & Infrastructure (batch 6)
  {
    name: "linode",
    displayName: "Linode",
    description: "Cloud computing and hosting",
    category: "Developer Tools",
    tags: ["cloud", "hosting", "vps"],
  },

  // Communication (batch 7)
  {
    name: "mailgun",
    displayName: "Mailgun",
    description: "Email delivery API",
    category: "Communication",
    tags: ["email", "api", "transactional"],
  },
  {
    name: "pusher",
    displayName: "Pusher",
    description: "Realtime messaging and channels",
    category: "Communication",
    tags: ["realtime", "websockets", "messaging"],
  },
  {
    name: "ably",
    displayName: "Ably",
    description: "Realtime messaging infrastructure",
    category: "Communication",
    tags: ["realtime", "messaging", "pubsub"],
  },
  {
    name: "vonage",
    displayName: "Vonage",
    description: "SMS, voice, and messaging APIs",
    category: "Communication",
    tags: ["sms", "voice", "messaging"],
  },
  {
    name: "messagebird",
    displayName: "MessageBird",
    description: "Omnichannel messaging platform",
    category: "Communication",
    tags: ["sms", "messaging", "omnichannel"],
  },

  // CRM (batch 8)
  {
    name: "pipedrive",
    displayName: "Pipedrive",
    description: "Sales CRM and pipeline management",
    category: "Business Tools",
    tags: ["crm", "sales", "pipeline"],
  },
  {
    name: "clearbit",
    displayName: "Clearbit",
    description: "Business intelligence and data enrichment",
    category: "Data & Analytics",
    tags: ["enrichment", "data", "b2b"],
  },

  // Productivity (batch 10)
  {
    name: "coda",
    displayName: "Coda",
    description: "Docs, tables, and automations",
    category: "Business Tools",
    tags: ["docs", "tables", "automation"],
  },
  {
    name: "monday",
    displayName: "Monday.com",
    description: "Work management and project tracking",
    category: "Business Tools",
    tags: ["project-management", "workflow"],
  },
  {
    name: "dropbox",
    displayName: "Dropbox",
    description: "Cloud file storage and sharing",
    category: "Business Tools",
    tags: ["storage", "files", "sharing"],
  },
  {
    name: "box",
    displayName: "Box",
    description: "Enterprise content management",
    category: "Business Tools",
    tags: ["storage", "enterprise", "content"],
  },
  {
    name: "miro",
    displayName: "Miro",
    description: "Visual collaboration and whiteboarding",
    category: "Business Tools",
    tags: ["whiteboard", "collaboration", "design"],
  },

  // Payments (batch 9)
  {
    name: "square",
    displayName: "Square",
    description: "Payments, POS, and commerce",
    category: "Commerce & Finance",
    tags: ["payments", "pos", "commerce"],
  },
  {
    name: "paddle",
    displayName: "Paddle",
    description: "SaaS billing and payments",
    category: "Commerce & Finance",
    tags: ["payments", "billing", "saas"],
  },
  {
    name: "chargebee",
    displayName: "Chargebee",
    description: "Subscription billing and revenue management",
    category: "Commerce & Finance",
    tags: ["billing", "subscriptions"],
  },

  // Analytics (batch 11)
  {
    name: "fathom",
    displayName: "Fathom Analytics",
    description: "Privacy-first website analytics",
    category: "Data & Analytics",
    tags: ["analytics", "privacy"],
  },
  {
    name: "snowflake",
    displayName: "Snowflake",
    description: "Cloud data warehouse",
    category: "Data & Analytics",
    tags: ["data", "warehouse", "sql"],
  },
  {
    name: "databricks",
    displayName: "Databricks",
    description: "Data lakehouse and ML platform",
    category: "Data & Analytics",
    tags: ["data", "ml", "lakehouse"],
  },
  {
    name: "datadog",
    displayName: "Datadog",
    description: "Monitoring and observability",
    category: "Developer Tools",
    tags: ["monitoring", "observability", "apm"],
  },
  {
    name: "grafana",
    displayName: "Grafana",
    description: "Dashboards and observability",
    category: "Developer Tools",
    tags: ["monitoring", "dashboards", "observability"],
  },

  // Social (batch 12)
  {
    name: "spotify",
    displayName: "Spotify",
    description: "Music streaming and playlists",
    category: "Social Media",
    tags: ["music", "streaming", "playlists"],
  },
  {
    name: "medium",
    displayName: "Medium",
    description: "Publishing and blogging platform",
    category: "Social Media",
    tags: ["writing", "blogging", "publishing"],
  },
  {
    name: "producthunt",
    displayName: "Product Hunt",
    description: "Product launches and discovery",
    category: "Social Media",
    tags: ["products", "launches", "tech"],
  },
  {
    name: "giphy",
    displayName: "Giphy",
    description: "GIF search and sharing",
    category: "Social Media",
    tags: ["gifs", "media", "search"],
  },
  {
    name: "imgur",
    displayName: "Imgur",
    description: "Image hosting and sharing",
    category: "Social Media",
    tags: ["images", "hosting", "sharing"],
  },
  {
    name: "mastodon",
    displayName: "Mastodon",
    description: "Decentralized social network",
    category: "Social Media",
    tags: ["social", "fediverse", "decentralized"],
  },

  // Marketing (batch 12)
  {
    name: "activecampaign",
    displayName: "ActiveCampaign",
    description: "Marketing automation and CRM",
    category: "Communication",
    tags: ["email", "marketing", "automation"],
  },
  {
    name: "brevo",
    displayName: "Brevo",
    description: "Email marketing and transactional emails",
    category: "Communication",
    tags: ["email", "marketing", "transactional"],
  },
  {
    name: "klaviyo",
    displayName: "Klaviyo",
    description: "E-commerce email and SMS marketing",
    category: "Communication",
    tags: ["email", "sms", "ecommerce"],
  },
  {
    name: "customerio",
    displayName: "Customer.io",
    description: "Messaging automation platform",
    category: "Communication",
    tags: ["messaging", "automation", "engagement"],
  },
  {
    name: "bannerbear",
    displayName: "Bannerbear",
    description: "Auto-generate images and videos",
    category: "Design & Content",
    tags: ["images", "automation", "templates"],
  },

  // Auth & Identity
  {
    name: "okta",
    displayName: "Okta",
    description: "Identity and access management",
    category: "Developer Tools",
    tags: ["auth", "identity", "sso"],
  },
  {
    name: "auth0",
    displayName: "Auth0",
    description: "Authentication and authorization platform",
    category: "Developer Tools",
    tags: ["auth", "identity", "oauth"],
  },

  // Design
  {
    name: "adobe",
    displayName: "Adobe",
    description: "Creative Cloud APIs",
    category: "Design & Content",
    tags: ["design", "creative", "pdf"],
  },

  // Finance
  {
    name: "plaid",
    displayName: "Plaid",
    description: "Banking and financial data",
    category: "Commerce & Finance",
    tags: ["banking", "fintech", "data"],
  },
  {
    name: "wise",
    displayName: "Wise",
    description: "International money transfers",
    category: "Commerce & Finance",
    tags: ["payments", "transfers", "forex"],
  },
  {
    name: "coingecko",
    displayName: "CoinGecko",
    description: "Cryptocurrency data and prices",
    category: "Data & Analytics",
    tags: ["crypto", "prices", "data"],
  },

  // IoT
  {
    name: "homeassistant",
    displayName: "Home Assistant",
    description: "Smart home automation",
    category: "Developer Tools",
    tags: ["iot", "smart-home", "automation"],
  },

  // HR
  {
    name: "bamboohr",
    displayName: "BambooHR",
    description: "HR management and employee data",
    category: "Business Tools",
    tags: ["hr", "employees", "management"],
  },

  // DevOps (additional)
  {
    name: "gitlab",
    displayName: "GitLab",
    description: "DevOps platform with git repos and CI/CD",
    category: "Developer Tools",
    tags: ["git", "cicd", "devops"],
  },
  {
    name: "uptimerobot",
    displayName: "UptimeRobot",
    description: "Website uptime monitoring",
    category: "Developer Tools",
    tags: ["monitoring", "uptime", "alerts"],
  },
  {
    name: "pagerduty",
    displayName: "PagerDuty",
    description: "Incident management and on-call",
    category: "Developer Tools",
    tags: ["incidents", "oncall", "alerts"],
  },
  {
    name: "launchdarkly",
    displayName: "LaunchDarkly",
    description: "Feature flags and experimentation",
    category: "Developer Tools",
    tags: ["feature-flags", "experimentation"],
  },

  // Batch: new connectors (3scribe - awscognito)
  {
    name: "3scribe",
    displayName: "3Scribe",
    description: "Audio and video transcription",
    category: "AI & ML",
    tags: ["transcription", "audio", "speech"],
  },
  {
    name: "7todos",
    displayName: "7todos",
    description: "Task management and to-do lists",
    category: "Business Tools",
    tags: ["tasks", "todo", "productivity"],
  },
  {
    name: "abstract",
    displayName: "Abstract API",
    description: "IP geolocation, email validation, and data enrichment APIs",
    category: "Data & Analytics",
    tags: ["geolocation", "validation", "enrichment"],
  },
  {
    name: "abuselpdb",
    displayName: "AbuseIPDB",
    description: "IP abuse checking and threat intelligence",
    category: "Developer Tools",
    tags: ["security", "ip", "threat-intelligence"],
  },
  {
    name: "accelo",
    displayName: "Accelo",
    description: "Professional services automation, projects, tickets, and CRM",
    category: "Business Tools",
    tags: ["psa", "projects", "crm"],
  },
  {
    name: "accredible",
    displayName: "Accredible",
    description: "Digital credentials, certificates, and badges",
    category: "Business Tools",
    tags: ["credentials", "certificates", "badges"],
  },
  {
    name: "accurai",
    displayName: "AccurAI",
    description: "AI-powered document data extraction and processing",
    category: "AI & ML",
    tags: ["ai", "document", "extraction"],
  },
  {
    name: "accuranker",
    displayName: "AccuRanker",
    description: "SEO keyword rank tracking and SERP monitoring",
    category: "Data & Analytics",
    tags: ["seo", "rank-tracking", "serp"],
  },
  {
    name: "acquire",
    displayName: "Acquire",
    description: "Customer support with live chat, video, and co-browsing",
    category: "Communication",
    tags: ["chat", "support", "video"],
  },
  {
    name: "actionnetwork",
    displayName: "Action Network",
    description: "Progressive organizing for petitions, events, and campaigns",
    category: "Business Tools",
    tags: ["organizing", "petitions", "campaigns"],
  },
  {
    name: "activetrail",
    displayName: "ActiveTrail",
    description: "Email marketing and automation",
    category: "Communication",
    tags: ["email", "marketing", "automation"],
  },
  {
    name: "adalo",
    displayName: "Adalo",
    description: "No-code app platform with collection and record management",
    category: "Developer Tools",
    tags: ["no-code", "app-builder", "mobile"],
  },
  {
    name: "adroll",
    displayName: "AdRoll",
    description: "Advertising platform for campaigns, ads, and audience segments",
    category: "Advertising",
    tags: ["ads", "retargeting", "campaigns"],
  },
  {
    name: "affinity",
    displayName: "Affinity",
    description: "Relationship intelligence CRM",
    category: "Business Tools",
    tags: ["crm", "relationships", "deals"],
  },
  {
    name: "agent",
    displayName: "Agent.ai",
    description: "AI agent platform with web extraction and content generation",
    category: "AI & ML",
    tags: ["ai", "agents", "automation"],
  },
  {
    name: "agilecrm",
    displayName: "Agile CRM",
    description: "CRM with contacts, deals, tasks, and marketing automation",
    category: "Business Tools",
    tags: ["crm", "sales", "marketing"],
  },
  {
    name: "aiagenttool",
    displayName: "AI Agent Tool",
    description: "AI agent tooling and orchestration",
    category: "AI & ML",
    tags: ["ai", "agents", "tools"],
  },
  {
    name: "airbrake",
    displayName: "Airbrake",
    description: "Error and performance monitoring",
    category: "Developer Tools",
    tags: ["monitoring", "errors", "performance"],
  },
  {
    name: "airnow",
    displayName: "AirNow",
    description: "Air quality data and forecasts",
    category: "Data & Analytics",
    tags: ["air-quality", "environment", "data"],
  },
  {
    name: "airtop",
    displayName: "Airtop",
    description: "Cloud browser automation and web interaction",
    category: "Developer Tools",
    tags: ["browser", "automation", "cloud"],
  },
  {
    name: "aitableai",
    displayName: "AITable.ai",
    description: "AI-powered spreadsheet and database platform",
    category: "Data & Analytics",
    tags: ["database", "spreadsheet", "ai"],
  },
  {
    name: "alchemy",
    displayName: "Alchemy",
    description: "Web3 and blockchain development platform",
    category: "Developer Tools",
    tags: ["blockchain", "web3", "ethereum"],
  },
  {
    name: "alerty",
    displayName: "Alerty",
    description: "Website and API monitoring with alerts",
    category: "Developer Tools",
    tags: ["monitoring", "alerts", "uptime"],
  },
  {
    name: "alienvault",
    displayName: "AlienVault OTX",
    description: "Open threat intelligence and security data",
    category: "Developer Tools",
    tags: ["security", "threat-intelligence", "otx"],
  },
  {
    name: "alphamoon",
    displayName: "Alphamoon",
    description: "AI document processing and intelligent data extraction",
    category: "AI & ML",
    tags: ["ai", "document", "ocr"],
  },
  {
    name: "alttextai",
    displayName: "AltText.ai",
    description: "AI-generated alt text for images",
    category: "AI & ML",
    tags: ["ai", "accessibility", "images"],
  },
  {
    name: "amadeus",
    displayName: "Amadeus",
    description: "Flight search, booking, and travel data",
    category: "Data & Analytics",
    tags: ["travel", "flights", "booking"],
  },
  {
    name: "amazon",
    displayName: "Amazon",
    description: "Amazon product and marketplace APIs",
    category: "Commerce & Finance",
    tags: ["ecommerce", "marketplace", "products"],
  },
  {
    name: "amilia",
    displayName: "Amilia",
    description: "Activity registration and recreation management",
    category: "Business Tools",
    tags: ["registration", "recreation", "scheduling"],
  },
  {
    name: "amqpsender",
    displayName: "AMQP Sender",
    description: "AMQP message queue producer",
    category: "Developer Tools",
    tags: ["amqp", "messaging", "queue"],
  },
  {
    name: "announcekit",
    displayName: "AnnounceKit",
    description: "Product changelog and release notes",
    category: "Business Tools",
    tags: ["changelog", "announcements", "product"],
  },
  {
    name: "anyscale",
    displayName: "Anyscale",
    description: "Enterprise LLM endpoints and Ray-based ML infrastructure",
    category: "AI & ML",
    tags: ["ai", "llm", "inference"],
  },
  {
    name: "apiary",
    displayName: "Apiary",
    description: "API design, documentation, and testing",
    category: "Developer Tools",
    tags: ["api", "documentation", "testing"],
  },
  {
    name: "apiflash",
    displayName: "ApiFlash",
    description: "Website screenshot capture API",
    category: "Developer Tools",
    tags: ["screenshots", "web", "api"],
  },
  {
    name: "apitemplateio",
    displayName: "APITemplate.io",
    description: "PDF and image generation from templates",
    category: "Design & Content",
    tags: ["pdf", "images", "templates"],
  },
  {
    name: "apptivegrid",
    displayName: "Apptivegrid",
    description: "Low-code database and business application platform",
    category: "Developer Tools",
    tags: ["low-code", "database", "apps"],
  },
  {
    name: "autom",
    displayName: "Autom",
    description: "Workflow automation and integration platform",
    category: "Business Tools",
    tags: ["automation", "workflows", "integration"],
  },
  {
    name: "automizy",
    displayName: "Automizy",
    description: "Email marketing automation",
    category: "Communication",
    tags: ["email", "marketing", "automation"],
  },
  {
    name: "autopilot",
    displayName: "Autopilot",
    description: "Marketing automation and customer journey mapping",
    category: "Communication",
    tags: ["marketing", "automation", "journeys"],
  },
  {
    name: "awscognito",
    displayName: "AWS Cognito",
    description: "User authentication and identity management",
    category: "Developer Tools",
    tags: ["auth", "identity", "aws"],
  },

  // Batch: new connectors (azureaisearchvectorstore - bugfender)
  {
    name: "azureaisearchvectorstore",
    displayName: "Azure AI Search Vector Store",
    description: "Vector search and indexing for AI applications",
    category: "AI & ML",
    tags: ["ai", "vector", "search", "azure"],
  },
  {
    name: "azurecosmosdb",
    displayName: "Azure Cosmos DB",
    description: "Globally distributed multi-model database",
    category: "Developer Tools",
    tags: ["database", "nosql", "azure"],
  },
  {
    name: "azureopenaichatmodel",
    displayName: "Azure OpenAI Chat Model",
    description: "OpenAI models hosted on Azure",
    category: "AI & ML",
    tags: ["ai", "llm", "openai", "azure"],
  },
  {
    name: "azurestorage",
    displayName: "Azure Storage",
    description: "Blob, file, queue, and table cloud storage",
    category: "Developer Tools",
    tags: ["storage", "cloud", "azure"],
  },
  {
    name: "badgermaps",
    displayName: "Badger Maps",
    description: "Field sales route planning and optimization",
    category: "Business Tools",
    tags: ["sales", "maps", "routing"],
  },
  {
    name: "bandwidth",
    displayName: "Bandwidth",
    description: "Voice, messaging, and emergency services APIs",
    category: "Communication",
    tags: ["voice", "sms", "messaging"],
  },
  {
    name: "baserow",
    displayName: "Baserow",
    description: "Open-source no-code database platform",
    category: "Developer Tools",
    tags: ["database", "no-code", "open-source"],
  },
  {
    name: "beeminder",
    displayName: "Beeminder",
    description: "Goal tracking with commitment contracts",
    category: "Business Tools",
    tags: ["goals", "tracking", "productivity"],
  },
  {
    name: "benchmarkemail",
    displayName: "Benchmark Email",
    description: "Email marketing campaigns and automation",
    category: "Communication",
    tags: ["email", "marketing", "campaigns"],
  },
  {
    name: "betterproposals",
    displayName: "Better Proposals",
    description: "Online proposal creation and tracking",
    category: "Business Tools",
    tags: ["proposals", "sales", "documents"],
  },
  {
    name: "bigcartel",
    displayName: "Big Cartel",
    description: "E-commerce platform for artists and makers",
    category: "Commerce & Finance",
    tags: ["ecommerce", "store", "artists"],
  },
  {
    name: "bigdatacloud",
    displayName: "BigDataCloud",
    description: "IP geolocation and reverse geocoding APIs",
    category: "Data & Analytics",
    tags: ["geolocation", "ip", "geocoding"],
  },
  {
    name: "bigml",
    displayName: "BigML",
    description: "Machine learning models and predictions",
    category: "AI & ML",
    tags: ["ml", "predictions", "models"],
  },
  {
    name: "bitly",
    displayName: "Bitly",
    description: "URL shortening and link management",
    category: "Developer Tools",
    tags: ["urls", "links", "shortener"],
  },
  {
    name: "bitrix24",
    displayName: "Bitrix24",
    description: "CRM, project management, and collaboration suite",
    category: "Business Tools",
    tags: ["crm", "project-management", "collaboration"],
  },
  {
    name: "bitwarden",
    displayName: "Bitwarden",
    description: "Password management and secrets vault",
    category: "Developer Tools",
    tags: ["passwords", "security", "vault"],
  },
  {
    name: "blaze",
    displayName: "Blaze",
    description: "Community engagement and membership platform",
    category: "Communication",
    tags: ["community", "engagement", "membership"],
  },
  {
    name: "blockchainexchange",
    displayName: "Blockchain Exchange",
    description: "Cryptocurrency trading and exchange",
    category: "Commerce & Finance",
    tags: ["crypto", "exchange", "trading"],
  },
  {
    name: "bloock",
    displayName: "Bloock",
    description: "Blockchain-based data integrity and verification",
    category: "Developer Tools",
    tags: ["blockchain", "integrity", "verification"],
  },
  {
    name: "bot9",
    displayName: "Bot9",
    description: "AI chatbot builder for customer support",
    category: "AI & ML",
    tags: ["ai", "chatbot", "support"],
  },
  {
    name: "botbaba",
    displayName: "BotBaba",
    description: "No-code chatbot builder for websites",
    category: "Communication",
    tags: ["chatbot", "no-code", "messaging"],
  },
  {
    name: "botifier",
    displayName: "Botifier",
    description: "Notification bots and alert automation",
    category: "Communication",
    tags: ["bots", "notifications", "alerts"],
  },
  {
    name: "botiumbox",
    displayName: "Botium Box",
    description: "Chatbot testing and quality assurance",
    category: "Developer Tools",
    tags: ["testing", "chatbot", "qa"],
  },
  {
    name: "botsonic",
    displayName: "Botsonic",
    description: "AI-powered custom chatbots trained on your data",
    category: "AI & ML",
    tags: ["ai", "chatbot", "custom"],
  },
  {
    name: "botstar",
    displayName: "BotStar",
    description: "Visual chatbot builder and automation",
    category: "Communication",
    tags: ["chatbot", "automation", "visual"],
  },
  {
    name: "brainpodai",
    displayName: "BrainPod AI",
    description: "AI content generation and writing assistant",
    category: "AI & ML",
    tags: ["ai", "content", "writing"],
  },
  {
    name: "brandblast",
    displayName: "BrandBlast",
    description: "AI-powered social media content management",
    category: "Social Media",
    tags: ["social", "content", "ai"],
  },
  {
    name: "brandfetch",
    displayName: "Brandfetch",
    description: "Brand logos, colors, and asset retrieval API",
    category: "Design & Content",
    tags: ["branding", "logos", "assets"],
  },
  {
    name: "brandmentions",
    displayName: "BrandMentions",
    description: "Brand monitoring and social listening",
    category: "Data & Analytics",
    tags: ["monitoring", "brand", "social-listening"],
  },
  {
    name: "breezyhr",
    displayName: "Breezy HR",
    description: "Recruiting and applicant tracking system",
    category: "Business Tools",
    tags: ["hr", "recruiting", "ats"],
  },
  {
    name: "brex",
    displayName: "Brex",
    description: "Business credit cards and spend management",
    category: "Commerce & Finance",
    tags: ["finance", "cards", "expense"],
  },
  {
    name: "browseai",
    displayName: "Browse AI",
    description: "No-code web scraping and data extraction",
    category: "Data & Analytics",
    tags: ["scraping", "data-extraction", "no-code"],
  },
  {
    name: "browserless",
    displayName: "Browserless",
    description: "Headless browser automation as a service",
    category: "Developer Tools",
    tags: ["browser", "automation", "headless"],
  },
  {
    name: "browserstack",
    displayName: "BrowserStack",
    description: "Cross-browser testing and mobile app testing",
    category: "Developer Tools",
    tags: ["testing", "browser", "mobile"],
  },
  {
    name: "bubble",
    displayName: "Bubble",
    description: "No-code web application builder",
    category: "Developer Tools",
    tags: ["no-code", "app-builder", "web"],
  },
  {
    name: "bugbug",
    displayName: "BugBug",
    description: "Browser-based automated testing",
    category: "Developer Tools",
    tags: ["testing", "automation", "browser"],
  },
  {
    name: "bugfender",
    displayName: "Bugfender",
    description: "Remote logging and crash reporting for apps",
    category: "Developer Tools",
    tags: ["logging", "crash-reporting", "mobile"],
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
