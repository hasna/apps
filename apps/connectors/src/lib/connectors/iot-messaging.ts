import type { ConnectorMeta } from "../registry.js";

// IoT & Messaging
export const connectors: ConnectorMeta[] = [
  {
    name: "mqtt",
    displayName: "MQTT",
    description: "Lightweight IoT messaging protocol client",
    category: "IoT & Messaging",
    tags: ["iot", "messaging", "protocol", "pubsub"],
  },
  {
    name: "philipshue",
    displayName: "Philips Hue",
    description: "Philips Hue smart lighting control API",
    category: "IoT & Messaging",
    tags: ["iot", "smart-home", "lighting", "philips", "hue"],
  },
  {
    name: "pushbullet",
    displayName: "Pushbullet",
    description: "Cross-device push notifications and file sharing API",
    category: "IoT & Messaging",
    tags: ["push-notifications", "messaging", "cross-device", "sharing", "alerts"],
  },
  {
    name: "pushcut",
    displayName: "Pushcut",
    description: "iOS automation triggers and smart notifications",
    category: "IoT & Messaging",
    tags: ["notifications", "automation", "ios", "shortcuts", "triggers"],
  },
  {
    name: "pushover",
    displayName: "Pushover",
    description: "Real-time push notifications for mobile and desktop devices",
    category: "IoT & Messaging",
    tags: ["push-notifications", "alerts", "mobile", "messaging", "real-time"],
  },
  {
    name: "samsungsmartthings",
    displayName: "Samsung SmartThings",
    description: "IoT platform for smart home device control and automation",
    category: "IoT & Messaging",
    tags: ["iot", "smart-home", "automation", "devices", "samsung"],
  },
  {
    name: "sms77",
    displayName: "SMS77",
    description: "SMS gateway and messaging API for business communications",
    category: "IoT & Messaging",
    tags: ["sms", "messaging", "api", "notifications", "gateway"],
  },
  {
    name: "smsit",
    displayName: "SMSit",
    description: "Bulk SMS sending and mobile messaging API service",
    category: "IoT & Messaging",
    tags: ["sms", "bulk messaging", "mobile", "notifications", "api"],
  },
  {
    name: "smsmagic",
    displayName: "SMS Magic",
    description: "Conversational messaging platform for sales and support teams",
    category: "IoT & Messaging",
    tags: ["sms", "messaging", "crm", "sales", "support"],
  },
  {
    name: "spontit",
    displayName: "Spontit",
    description: "Push notification service for web and mobile applications",
    category: "IoT & Messaging",
    tags: ["push notifications", "mobile", "web", "alerts", "messaging"],
  },
  {
    name: "triggercmd",
    displayName: "TRIGGERcmd",
    description: "Remote command automation and trigger execution API",
    category: "IoT & Messaging",
    tags: ["iot", "automation", "remote-commands", "triggers"],
  },
];
