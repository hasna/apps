import type { ConnectorMeta } from "../registry.js";

// Healthcare & Hospitality
export const connectors: ConnectorMeta[] = [
  {
    name: "mews",
    displayName: "Mews",
    description: "Hospitality property management and booking platform",
    category: "Healthcare & Hospitality",
    tags: ["hospitality", "hotel", "booking", "pms"],
  },
  {
    name: "oura",
    displayName: "Oura",
    description: "Oura Ring health and sleep tracking data API",
    category: "Healthcare & Hospitality",
    tags: ["health", "sleep", "wearable", "fitness", "biometrics"],
  },
  {
    name: "planyoonlinebooking",
    displayName: "Planyo Online Booking",
    description: "Online booking and reservation management system",
    category: "Healthcare & Hospitality",
    tags: ["booking", "reservations", "scheduling", "hospitality", "appointments"],
  },
  {
    name: "takecareos",
    displayName: "TakeCareOS",
    description: "Home care agency OS — clients, caregivers, shifts, incidents, compliance",
    category: "Healthcare & Hospitality",
    tags: ["homecare", "healthcare", "scheduling", "caregivers", "compliance"],
  },
];
