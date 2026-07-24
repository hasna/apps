import type { ConnectorMeta } from "../registry.js";

// Patents & IP
export const connectors: ConnectorMeta[] = [
  {
    name: "uspto",
    displayName: "USPTO",
    description: "US Patent and Trademark Office",
    category: "Patents & IP",
    tags: ["patents", "trademarks", "ip"],
  },
  {
    name: "epo",
    displayName: "EPO",
    description: "European Patent Office Open Patent Services for patent search and retrieval",
    category: "Patents & IP",
    tags: ["patents", "intellectual-property", "epo", "search"],
  },
  {
    name: "patentsview",
    displayName: "PatentsView",
    description: "USPTO patent analytics API for searching patents, inventors, and assignees",
    category: "Patents & IP",
    tags: ["patents", "uspto", "ip", "inventors", "research"],
  },
  {
    name: "wipo",
    displayName: "WIPO",
    description: "World Intellectual Property Organization - patents, trademarks, and IP data",
    category: "Patents & IP",
    tags: ["patents", "trademarks", "ip", "wipo"],
  },
  {
    name: "stilta",
    displayName: "Stilta",
    description: "Stilta API: patent search, research jobs, and prior-art analysis",
    category: "Patents & IP",
    tags: ["patents", "ip", "research", "prior-art"],
  },
];
